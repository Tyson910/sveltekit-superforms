import type { JSONSchema7Definition } from 'json-schema';
import type { JSONSchema } from './jsonSchema/index.js';
import justClone from 'just-clone';
import { SchemaError } from './errors.js';

// Thanks to: https://dev.to/tylim88/typescript-numeric-range-type-15a5#comment-22mld
export type NumericRange<
	START extends number,
	END extends number,
	ARR extends unknown[] = [],
	ACC extends number = never
> = ARR['length'] extends END
	? ACC | START | END
	: NumericRange<START, END, [...ARR, 1], ARR[START] extends undefined ? ACC : ACC | ARR['length']>;

export type ErrorStatus = NumericRange<400, 599>;

export function clone<T>(data: T): T {
	return data && typeof data === 'object' ? justClone(data) : data;
}

export type MaybePromise<T> = T | Promise<T>;

// eslint-disable-next-line @typescript-eslint/ban-types
export type Prettify<T> = T extends object ? { [K in keyof T]: T[K] } : T & {};

// Thanks to https://stackoverflow.com/a/77451367/70894
export type IsAny<T> = boolean extends (T extends never ? true : false) ? true : false;

export type BuiltInObjects = Date | Set<unknown> | File;

export type DeepPartial<T> = {
	[K in keyof T]?: NonNullable<T[K]> extends BuiltInObjects
		? T[K]
		: NonNullable<T[K]> extends (infer U)[]
			? NonNullable<U> extends BuiltInObjects
				? U[]
				: DeepPartial<U>[]
			: NonNullable<T[K]> extends object
				? DeepPartial<T[K]>
				: T[K];
};

export function assertSchema(
	schema: JSONSchema7Definition,
	path: string | (string | number | symbol)[]
): asserts schema is JSONSchema {
	if (typeof schema === 'boolean') {
		throw new SchemaError('Schema property cannot be defined as boolean.', path);
	}
}
