// Test reporter that only sets the exit code. Node 22's runner reports a describe() callback that throws
// as "not ok" but still counts 0 failures and exits 0, so a whole suite could silently stop running.
// Any failure event (test or suite) now fails `npm test`.
export default async function* failOnAnyFailure(source) {
  for await (const event of source) {
    if (event.type === 'test:fail') process.exitCode = 1;
  }
}
