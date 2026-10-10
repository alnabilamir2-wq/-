export function ForbiddenError(message = "Forbidden"): Error {
  const error = new Error(message);
  error.name = "ForbiddenError";
  return error;
}
