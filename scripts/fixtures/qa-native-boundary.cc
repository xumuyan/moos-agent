// Diagnostic-format calibration only. These are deliberately named fixture
// functions, NOT Electron/Chromium/Node implementations or shutdown evidence.
#include <cstdio>
#include <unistd.h>

static void waitForRelease() {
  std::puts("ready");
  std::fflush(stdout);
  char release;
  // Keep a stable main-thread call chain until the owning test releases stdin.
  (void)::read(STDIN_FILENO, &release, 1);
}

namespace base {
struct RunLoop { __attribute__((noinline)) static void Run(); };
void RunLoop::Run() { waitForRelease(); }
}
namespace node {
__attribute__((noinline)) void Stop() { base::RunLoop::Run(); }
}
namespace electron {
struct ElectronBrowserContext {
  __attribute__((noinline)) static void DestroyAllContexts();
};
void ElectronBrowserContext::DestroyAllContexts() { node::Stop(); }
struct ElectronBrowserMainParts {
  __attribute__((noinline)) static void PostMainMessageLoopRun();
};
void ElectronBrowserMainParts::PostMainMessageLoopRun() {
  ElectronBrowserContext::DestroyAllContexts();
}
}
struct ProcessSingleton { __attribute__((noinline)) static void Cleanup(); };
void ProcessSingleton::Cleanup() {
  electron::ElectronBrowserMainParts::PostMainMessageLoopRun();
}
int main(int argc, char**) {
  // Independent backstop; no signals are sent to any other process.
  ::alarm(12);
  if (argc > 1) waitForRelease(); // same binary, known frames not on main stack
  else ProcessSingleton::Cleanup();
  return 0;
}
