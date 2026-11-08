// Never echo subprocess output or arbitrary exception messages: either can
// contain connection strings, environment values or credentials.
export function serviceFailureReason(error: unknown): string {
  if (error instanceof AggregateError)
    return serviceFailureReason(error.errors[0]);
  const code = (error as { code?: unknown } | null)?.code;
  if (
    typeof code === "string" &&
    /^(ECONNREFUSED|ETIMEDOUT|EACCES|EPERM|ENOENT|EADDRINUSE)$/.test(code)
  )
    return code;
  return "prerequisite or subprocess failure";
}

export class ServiceOperationError extends Error {
  constructor(action: string, service: string, reason: string) {
    super(
      `Service ${action} failed: ${service} (${reason}); check logs/${service}.log and logs/${service}.error.log`,
    );
  }
}

export function serviceErrorMessage(error: unknown): string {
  return error instanceof ServiceOperationError
    ? error.message
    : `Service command failed: ${serviceFailureReason(error)}; check Docker port publishing, Windows excluded port ranges, service logs and owner ACL permissions`;
}
