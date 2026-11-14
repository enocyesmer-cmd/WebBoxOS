#!/usr/bin/env python3
"""Empaqueta los módulos ES de WebBox OS para abrirlos mediante file://.

No requiere dependencias externas. La versión HTTP sigue cargando js/main.js
como módulo ES; este script genera js/bundle.js para Chromium con doble clic.
"""

from __future__ import annotations

import json
import posixpath
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRY = "js/main.js"
OUTPUT = ROOT / "js" / "bundle.js"

IMPORT_RE = re.compile(
    r"(?m)^[ \t]*import\s*\{([^}]+)\}\s*from\s*(['\"])([^'\"]+)\2\s*;?[ \t]*$"
)
EXPORT_RE = re.compile(
    r"(?m)^export\s+((?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*))"
)


def resolve_import(source_id: str, relative: str) -> str:
    if not relative.startswith("."):
        raise ValueError(f"Import no relativo no compatible en {source_id}: {relative}")
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source_id), relative))
    if not resolved.endswith(".js"):
        raise ValueError(f"Solo se admiten módulos .js: {source_id} -> {relative}")
    return resolved


def collect_modules(entry: str) -> list[tuple[str, str, list[str]]]:
    ordered: list[tuple[str, str, list[str]]] = []
    visited: set[str] = set()

    def visit(module_id: str) -> None:
        if module_id in visited:
            return
        visited.add(module_id)
        path = ROOT / module_id
        if not path.is_file():
            raise FileNotFoundError(f"No se encontró el módulo: {module_id}")

        source = path.read_text(encoding="utf-8")
        dependencies: list[tuple[str, str]] = []
        for match in IMPORT_RE.finditer(source):
            imported_names = match.group(1)
            dependency_id = resolve_import(module_id, match.group(3))
            dependencies.append((match.group(0), dependency_id))
            visit(dependency_id)

        exports = [match.group(2) for match in EXPORT_RE.finditer(source)]
        for original, dependency_id in dependencies:
            source = source.replace(
                original,
                f"const {{ {', '.join(name.strip() for name in _import_names(original))} }} = __require({json.dumps(dependency_id)});",
                1,
            )
        source = EXPORT_RE.sub(lambda match: match.group(1), source)

        if re.search(r"(?m)^\s*(?:import|export)\s", source):
            raise ValueError(f"Quedó sintaxis ES Modules sin convertir en {module_id}")
        ordered.append((module_id, source, exports))

    visit(entry)
    return ordered


def _import_names(statement: str) -> list[str]:
    match = IMPORT_RE.match(statement)
    if not match:
        raise ValueError(f"Import no compatible: {statement}")
    names = []
    for part in match.group(1).split(","):
        name = part.strip()
        if not name or " as " in name:
            raise ValueError(f"Import con alias no compatible: {statement}")
        names.append(name)
    return names


def build() -> int:
    modules = collect_modules(ENTRY)
    chunks = [
        "/* WebBox OS — bundle generado por tools/build.py. No editar a mano. */",
        "(function () {",
        "  'use strict';",
        "  const __modules = Object.create(null);",
    ]

    for module_id, source, exports in modules:
        chunks.append(f"  __modules[{json.dumps(module_id)}] = function (module, exports, __require) {{")
        chunks.append(source.rstrip())
        if exports:
            chunks.append(f"    Object.assign(exports, {{ {', '.join(exports)} }});")
        chunks.append("  };")

    chunks.extend([
        "  const __cache = Object.create(null);",
        "  function __require(id) {",
        "    if (__cache[id]) return __cache[id].exports;",
        "    const factory = __modules[id];",
        "    if (!factory) throw new Error('Módulo no encontrado: ' + id);",
        "    const module = { exports: {} };",
        "    __cache[id] = module;",
        "    factory(module, module.exports, __require);",
        "    return module.exports;",
        "  }",
        f"  __require({json.dumps(ENTRY)});",
        "})();",
        "",
    ])

    OUTPUT.write_text("\n".join(chunks), encoding="utf-8")
    size = OUTPUT.stat().st_size
    print(f"Bundle generado: {OUTPUT.relative_to(ROOT)} ({len(modules)} módulos, {size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(build())
