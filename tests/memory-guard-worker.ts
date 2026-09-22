// Runs on its own thread (see tests/setup.ts) and kills the test process if
// its memory passes a hard limit.
//
// Why a separate thread: the failure it guards against is synchronous. When an
// assertion fails on a value that holds DOM nodes, bun's failure printer walks
// the entire happy-dom object graph and allocates without end — observed
// reaching 10 GB and getting the whole terminal killed by the kernel's
// out-of-memory killer. While that happens the main thread never returns to
// its event loop, so a timer there would never fire. This thread's does.
declare const self: Worker;

const LIMIT_MB = Number(process.env.BELZ_TEST_MEMORY_LIMIT_MB || 1024);
const CHECK_MS = 200;

setInterval(() => {
  const rssMb = process.memoryUsage().rss / 1024 / 1024;
  if (rssMb < LIMIT_MB) return;
  process.stderr.write(
    `\n\n[memory guard] test process passed ${LIMIT_MB} MB (at ${Math.round(rssMb)} MB) — killed.\n` +
      '  Most likely cause: an expect() on an object that holds DOM nodes failed, and\n' +
      '  printing it walks the whole DOM. Assert on plain fields instead.\n' +
      '  Raise the limit with BELZ_TEST_MEMORY_LIMIT_MB if a test genuinely needs more.\n\n'
  );
  process.kill(process.pid, 'SIGKILL');
}, CHECK_MS);
