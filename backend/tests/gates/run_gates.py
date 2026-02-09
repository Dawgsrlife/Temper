#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import inspect
import sys
import traceback
import types
from contextlib import contextmanager
from pathlib import Path


def _import_module_from_path(path: Path, module_name: str, package_name: str) -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(module_name, str(path))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not build import spec for {path}")
    module = importlib.util.module_from_spec(spec)
    module.__package__ = package_name
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


@contextmanager
def _api_env_context(conftest_module: types.ModuleType):
    api_env = getattr(conftest_module, "api_env", None)
    if api_env is None:
        raise RuntimeError("conftest missing api_env fixture")
    generator_fn = getattr(api_env, "__wrapped__", api_env)
    generator = generator_fn()
    env = next(generator)
    try:
        yield env
    finally:
        try:
            next(generator)
        except StopIteration:
            pass


def _run_test_function(
    *,
    module_name: str,
    function_name: str,
    fn,
    conftest_module: types.ModuleType,
) -> tuple[bool, str | None]:
    signature = inspect.signature(fn)
    params = list(signature.parameters.keys())
    try:
        if not params:
            fn()
        elif params == ["api_env"]:
            with _api_env_context(conftest_module) as api_env:
                fn(api_env)
        else:
            return False, f"{module_name}.{function_name} has unsupported params: {params}"
    except Exception:
        return False, traceback.format_exc()
    return True, None


def main() -> int:
    gates_dir = Path(__file__).resolve().parent
    backend_dir = gates_dir.parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))
    test_files = sorted(gates_dir.glob("test_*.py"))
    if not test_files:
        print("No gate tests found.")
        return 1

    package_name = "_gates_runtime"
    package_module = types.ModuleType(package_name)
    package_module.__path__ = [str(gates_dir)]  # type: ignore[attr-defined]
    sys.modules[package_name] = package_module

    try:
        conftest = _import_module_from_path(
            gates_dir / "conftest.py",
            module_name=f"{package_name}.conftest",
            package_name=package_name,
        )
    except Exception:
        print("Import failed for conftest.py")
        print(traceback.format_exc())
        return 1

    imported_modules: list[types.ModuleType] = []
    for test_file in test_files:
        module_name = f"{package_name}.{test_file.stem}"
        try:
            module = _import_module_from_path(
                test_file,
                module_name=module_name,
                package_name=package_name,
            )
        except Exception:
            print(f"Import failed for {test_file.name}")
            print(traceback.format_exc())
            return 1
        imported_modules.append(module)

    tests_run = 0
    failures = 0
    
    # Enter the API environment context once for the entire suite
    with _api_env_context(conftest) as api_env:
        for module in imported_modules:
            for function_name, fn in sorted(inspect.getmembers(module, inspect.isfunction)):
                if not function_name.startswith("test_"):
                    continue
                tests_run += 1
                
                # Check signature to see if api_env is needed
                signature = inspect.signature(fn)
                params = list(signature.parameters.keys())
                
                try:
                    if not params:
                        fn()
                        ok, error = True, None
                    elif params == ["api_env"]:
                        fn(api_env)
                        ok, error = True, None
                    else:
                        ok, error = False, f"{module.__name__}.{function_name} has unsupported params: {params}"
                except Exception:
                    ok, error = False, traceback.format_exc()

                if ok:
                    print(f"PASS {module.__name__}.{function_name}")
                else:
                    failures += 1
                    print(f"FAIL {module.__name__}.{function_name}")
                    if error:
                        print(error)

    print(f"Ran {tests_run} gate tests; failures={failures}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
