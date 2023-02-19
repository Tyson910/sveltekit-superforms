import { fail, type RequestEvent } from '@sveltejs/kit';
import { parse } from 'devalue';
import type { Validation, ValidatedEntity, ValidationErrors } from '..';

import {
	ZodAny,
	ZodDefault,
	ZodNullable,
	ZodOptional,
	ZodString,
	type AnyZodObject,
	z,
	ZodNumber,
	ZodBoolean,
	ZodDate,
	ZodLiteral,
	ZodUnion,
	ZodArray
} from 'zod';

type DefaultFields<T extends AnyZodObject> = Partial<{
	[Property in keyof z.infer<T>]:
		| z.infer<T>[Property]
		| ((
				value: z.infer<T>[Property] | null | undefined,
				data: z.infer<T>
		  ) => z.infer<T>[Property] | null | undefined);
}>;

function setValidationDefaults<T extends AnyZodObject>(
	data: Validation<T>['data'],
	fields: DefaultFields<T>
) {
	for (const stringField of Object.keys(fields)) {
		const field = stringField as keyof typeof data;
		const currentData = data[field];

		if (typeof fields[field] === 'function') {
			// eslint-disable-next-line @typescript-eslint/ban-types
			const func = fields[field] as Function;
			data[field] = func(currentData, data);
		} else if (!currentData) {
			data[field] = fields[field] as never;
		}
	}
}

const defaultEntityCache: WeakMap<AnyZodObject, z.infer<AnyZodObject>> = new WeakMap<
	AnyZodObject,
	z.infer<AnyZodObject>
>();

/**
 * Returns the default values for a zod validation schema.
 * The main gotcha is that undefined values are changed to null if the field is nullable.
 */
export function defaultEntity<T extends AnyZodObject>(
	schema: T,
	options: { defaults?: DefaultFields<T>; skip?: (keyof z.infer<T>)[] } = {}
): z.infer<T> {
	options = { ...options };

	if (defaultEntityCache && !options.defaults && defaultEntityCache.has(schema)) {
		return defaultEntityCache.get(schema) as z.infer<T>;
	}

	const fields = Object.keys(schema.keyof().Values).filter(
		(field) => !options.skip || !options.skip.includes(field)
	);

	let output: Record<string, unknown> = {};
	let defaultKeys: string[] | undefined;

	if (options.defaults) {
		setValidationDefaults(output, options.defaults);
		defaultKeys = Object.keys(options.defaults);
	}

	// Need to set empty properties after defaults are set.
	output = Object.fromEntries(
		fields.map((f) => {
			const value =
				defaultKeys && defaultKeys.includes(f)
					? output[f]
					: _valueOrDefault(schema, f, undefined).value;

			return [f, value];
		})
	);

	if (defaultEntityCache && !options.defaults && !defaultEntityCache.has(schema)) {
		defaultEntityCache.set(schema, output);
	}

	return output;
}

export function setError<T extends AnyZodObject>(
	form: Validation<T>,
	field: keyof (typeof form)['data'],
	error: string | string[] | null
) {
	const errArr = Array.isArray(error) ? error : error ? [error] : [];

	if (form.errors[field]) {
		form.errors[field] = form.errors[field]?.concat(errArr);
	} else {
		form.errors[field] = errArr;
	}
	form.success = false;
	return fail(400, { form });
}

export function noErrors<T extends AnyZodObject>(form: Validation<T>): Validation<T> {
	return { ...form, errors: {} };
}

function formDataToValidation<T extends AnyZodObject>(schema: T, fields: string[], data: FormData) {
	const output: Record<string, unknown> = {};

	for (const key of fields) {
		const entry = data.get(key);
		if (entry && typeof entry !== 'string') {
			// File object
			output[key] = entry;
		} else {
			output[key] = parseEntry(key, entry);
		}
	}

	function parseEntry(field: string, value: string | null): unknown {
		const newValue = _valueOrDefault(schema, field, value, false);

		/*
      d(field, value, {
      ...newValue,
      type: newValue.type.constructor.name
    });
    */

		// If empty, it now has the default value, so it can be returned
		if (newValue.wasEmpty) return newValue.value;

		const zodType = newValue.type;

		if (zodType instanceof ZodString) {
			return value;
		} else if (zodType instanceof ZodNumber) {
			return parseFloat(value ?? '');
		} else if (zodType instanceof ZodDate) {
			return new Date(value ?? '');
		} else if (zodType instanceof ZodBoolean) {
			return Boolean(value).valueOf();
		} else if (zodType instanceof ZodArray) {
			if (!value) return [];
			const arrayType = zodType._def.type;
			if (arrayType instanceof ZodNumber) {
				return value.split(',').map((v) => parseFloat(v));
			} else if (arrayType instanceof ZodString) {
				return value.split(',').map((v) => decodeURIComponent(v));
			} else if (arrayType instanceof ZodBoolean) {
				return value.split(',').map((v) => Boolean(v).valueOf());
			} else {
				throw new Error('Unsupported ZodArray type: ' + typeof zodType.constructor.name);
			}
		} else if (zodType instanceof ZodLiteral) {
			if (typeof zodType.value === 'string') return value;
			else if (typeof zodType.value === 'number') return parseFloat(value ?? '');
			else if (typeof zodType.value === 'boolean') return Boolean(value).valueOf();
			else {
				throw new Error('Unsupported ZodLiteral default type: ' + typeof zodType.value);
			}
		} else if (zodType instanceof ZodUnion || zodType instanceof ZodAny) {
			return value;
		}

		throw new Error('Unsupported Zod default type: ' + zodType.constructor.name);
	}

	return output;
}

// Internal function, do not export.
function _valueOrDefault<T extends AnyZodObject>(
	schema: T,
	field: keyof z.infer<T>,
	value: unknown,
	strict = true
) {
	let zodType = schema.shape[field];
	let wrapped = true;
	let isNullable = false;
	let isOptional = false;
	let defaultValue: unknown = undefined;

	//let i = 0;
	//d(field);
	while (wrapped) {
		//d(' '.repeat(++i * 2) + zodType.constructor.name);
		if (zodType instanceof ZodNullable) {
			isNullable = true;
			zodType = zodType.unwrap();
		} else if (zodType instanceof ZodDefault) {
			defaultValue = zodType._def.defaultValue();
			zodType = zodType._def.innerType;
		} else if (zodType instanceof ZodOptional) {
			isOptional = true;
			zodType = zodType.unwrap();
		} else {
			wrapped = false;
		}
	}

	/*
  d(field, {
    zodType: zodType.constructor.name,
    isNullable,
    isOptional,
    defaultValue
  });
  */

	// Based on schema type, check what the empty value should be parsed to
	function emptyValue() {
		// For convenience, make undefined into nullable if possible.
		// otherwise all nullable fields requires a default value or optional.
		// In the database, null is assumed if no other value (undefined doesn't exist there),
		// so this should be ok.
		// Also make a check for strict, so empty strings from FormData can also be set here.
		if (strict && value !== undefined) return value;
		if (defaultValue !== undefined) return defaultValue;
		if (isNullable) return null;
		if (isOptional) return undefined;
		if (zodType instanceof ZodString) return '';
		if (zodType instanceof ZodBoolean) return false;
		if (zodType instanceof ZodArray) return [];

		throw new Error(
			`Unsupported type for ${strict ? 'strict' : 'falsy'} values on field "${String(field)}": ${
				zodType.constructor.name
			}. Add default, optional or nullable to the schema, or use the "defaults" option.`
		);
	}

	if (value) return { value: value as unknown, wasEmpty: false, type: zodType };
	else return { value: emptyValue() as unknown, wasEmpty: true, type: zodType };
}

//type NoFieldNamed<T, Field> = Extract<Field, keyof T> extends never ? T : never;

/**
 * Validates a Zod schema for usage in a SvelteKit form.
 * @param data Data structure for a Zod schema, or RequestEvent/FormData. If falsy, defaultEntity will be used.
 * @param schema The Zod schema to validate against.
 * @param options.defaults An object with keys that can be a default value, or a function that will be called to get the default value.
 * @param options.noErrors For load requests, this is usually set to prevent validation errors from showing directly on a GET request.
 * @returns An object with success, errors and data properties.
 */
export async function superValidate<T extends AnyZodObject>(
	data:
		| RequestEvent
		| Request
		| FormData
		| Partial<Record<keyof z.infer<T>, unknown>>
		| ValidatedEntity<Partial<z.infer<T>>, string | number>
		| null
		| undefined,
	schema: T,
	options: {
		defaults?: DefaultFields<T>;
		noErrors?: boolean;
	} = {}
): Promise<Validation<T>> {
	options = { ...options };

	const schemaKeys = Object.keys(schema.keyof().Values);
	let empty = false;

	function parseJson(value: string | undefined) {
		if (!value) return {};
		try {
			return parse(value);
		} catch (_) {
			return {};
		}
	}

	function parseFormData(data: FormData) {
		if (data.has('json')) return parseJson(data.get('json')?.toString());
		else return formDataToValidation(schema, schemaKeys, data);
	}

	async function tryParseFormData(request: Request) {
		try {
			const formData = await request.formData();
			return parseFormData(formData);
		} catch {
			empty = true;
			return defaultEntity(schema, options);
		}
	}

	if (!data) {
		data = defaultEntity(schema, options);
		empty = true;
	} else if (data instanceof FormData) {
		data = parseFormData(data);
	} else if (data instanceof Request) {
		data = await tryParseFormData(data);
	} else if ('request' in data && data.request instanceof Request) {
		data = await tryParseFormData(data.request);
	} else if ('exists' in data) {
		const entity = data as ValidatedEntity<Partial<z.infer<T>>, string | number>;
		data = entity.exists ? entity.data : defaultEntity(schema, options);
		empty = !entity.exists;
		if (options && options.defaults) setValidationDefaults(data, options.defaults);
	}

	if (empty) {
		return { success: true, errors: {}, data: data as z.infer<T>, empty, message: null };
	}

	const status = schema.safeParse(data);

	if (!status.success) {
		const errors = options.noErrors
			? {}
			: (status.error.flatten().fieldErrors as ValidationErrors<T>);
		return { success: false, errors, data: data as z.infer<T>, empty, message: null };
	} else {
		return { success: true, errors: {}, data: status.data, empty, message: null };
	}
}