// Observer wrapper (FR-016): the mod never changes what a hook passes on.
// The task may update colony state; whatever it does, the hook returns passOn() unchanged.

export type Passthrough<D, E, R> = (dollar: D, e: E, next: (e: E) => R | Promise<R>) => Promise<R>

// Runs the observer task, swallowing any error, then answers with passOn() (normally next(e)).
export async function guarded<R>(
  task: () => unknown,
  passOn: () => R | Promise<R>,
  onError: (error: unknown) => void = () => {},
): Promise<R> {
  try {
    await task()
  } catch (error) {
    onError(error)
  }
  return passOn()
}

export function observe<D, E, R>(
  handler: (dollar: D, e: E) => unknown,
  onError: (error: unknown) => void = () => {},
): Passthrough<D, E, R> {
  return (dollar, e, next) => guarded(() => handler(dollar, e), () => next(e), onError)
}
