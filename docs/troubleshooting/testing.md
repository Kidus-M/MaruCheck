# Test runner notes

Vitest is configured to use Vite's native configuration loader and the worker-thread pool.

On managed Windows environments, creating child processes may be restricted. Vite's default bundled configuration loader calls `net use` while resolving paths, and Vitest's default fork pool creates child Node.js processes. Either operation can fail with `spawn EPERM` even though the tests themselves are valid.

The checked-in test command avoids those unnecessary child processes without skipping, filtering, or weakening any tests. CI uses the same command so local and hosted behavior remain aligned.
