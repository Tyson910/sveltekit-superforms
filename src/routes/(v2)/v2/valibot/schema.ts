import { object, string, minLength, email, pipe } from 'valibot';

export const schema = object({
	name: pipe(string(), minLength(2)),
	email: pipe(string(), email())
});
