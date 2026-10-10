export function assertOAuthProjectScope(projectId: unknown, expectedProjectId: string): void {
  // The OAuth access token is already client-scoped; when the identity service returns
  // its projectId, fail closed if it names a different Webdev project.
  if (projectId !== undefined && projectId !== null) {
    if (typeof projectId !== "string" || projectId !== expectedProjectId) {
      throw new Error("OAuth identity belongs to a different project");
    }
  }
}
