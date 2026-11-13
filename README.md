# la-fruteria

**Español** · [English](README.en.md)

Un marketplace de Claude Code con un solo plugin: `dev-factory`.

**Qué hace, en una frase:** impide que un agente de IA rompa las reglas del equipo, aunque lo intente.

| Sin el plugin | Con `dev-factory` |
|---|---|
| El agente hace commit directo en `main` | Bloqueado. Debe crear una rama `feat/`, `fix/` o `hotfix/` |
| El agente desactiva los hooks de git para saltarse una regla | Bloqueado. No puede tocar esos archivos |
| El agente firma el commit como coautor | Bloqueado. Los commits son solo de la persona |
| El agente dice "listo" con los tests en rojo | No puede terminar hasta que pasen |

No tiene dependencias (solo Node) y cada revisión tarda unos 50 ms: no se nota.

## Instalación

Dentro del proyecto, un solo comando:

```bash
npx github:enderdev01/la-fruteria
```

Instala o actualiza el marketplace y el plugin, instala los hooks de git (si editaste alguno, guarda una copia `.local-<fecha>` antes de reemplazarlo), te pregunta si confías en el proyecto y reabre Claude Code con un saludo.

Manual (si prefieres):

```bash
claude plugin marketplace add enderdev01/la-fruteria
claude plugin install dev-factory@factory-marketplace
```

Luego, en cada proyecto dentro de `~/DEV`:

| Paso | Qué hacer | Para qué |
|---|---|---|
| 1 | Pedirle a Claude que ejecute la skill `create-verification-skill` | Crea el script de verificación, los hooks de git y el mapa de funcionalidades |
| 2 | Escribir `/dev-factory:trust` en la sesión | Autoriza al plugin a ejecutar los tests de ese proyecto |
| 3 | Abrir una sesión nueva y trabajar normal | Las protecciones actúan solas |

## Cómo funciona

Cada vez que el agente quiere hacer algo, el plugin lo revisa **antes** de que ocurra.

```text
     El agente quiere ejecutar un comando o editar un archivo
                               |
                               v
                       ¿Rompe una regla?
                        |             |
                       SÍ             NO
                        |             |
                        v             v
                   BLOQUEADO      SE EJECUTA
             recibe el motivo,        |
           corrige y reintenta        v
                            ¿El agente quiere terminar?
                              |                   |
                        tests en rojo       tests en verde
                              |                   |
                              v                   v
                         NO TERMINA        SESIÓN TERMINADA
                       recibe el error
                        y lo arregla
```

Hay dos barreras, una detrás de la otra:

| Barrera | Cuándo actúa | A quién aplica |
|---|---|---|
| **Hooks de Claude Code** | Antes de cada comando o edición del agente | Solo a los agentes |
| **Hooks de git** | En cada `commit` y `push` | A todos: agentes y personas, incluso sin el plugin instalado |

La primera es rápida pero se puede esquivar con ingenio (un script, por ejemplo). La segunda es la que manda: si algo se escapa de la primera, git lo frena.

### Las cinco protecciones

| Protección | Qué revisa | Ejemplo de lo que frena |
|---|---|---|
| `branch-guard` | En qué rama se hace commit o push | `git commit` estando en `main` |
| `path-guard` | Qué archivos se modifican | Borrar la carpeta `.githooks` |
| `attribution-guard` | El mensaje y el autor del commit | Una línea `Co-Authored-By` de una IA |
| `check-file` | El archivo recién editado, con ESLint | Un error de lint que el agente dejó |
| `verify-gate` | Los tests del proyecto, al terminar | Dar por terminada una tarea con tests rotos |

### El equipo de agentes

El plugin también reparte el trabajo: el modelo caro solo se usa donde hace falta.

| Agente | Modelo | Qué hace | Cuándo se usa |
|---|---|---|---|
| 🍋 `lemon` | El de la sesión | Organiza y reparte | Siempre: es la sesión principal |
| 🥝 `kiwi` | Haiku (barato) | Busca en el código, sin editar | Antes de tocar algo desconocido |
| 🫐 `fig` | Haiku (barato) | Lee salidas largas de tests y builds | Cuando algo falla |
| 🥭 `mango` | Sonnet (medio) | Implementa una tarea bien definida | Cuando ya se sabe qué construir |
| 🍒 `cherry` | Sonnet (Opus si es riesgoso) | Comprueba que el cambio funciona, con evidencia | Al terminar un cambio importante |

Detalle completo de reglas, alcance y modelo de confianza: [plugins/dev-factory/README.md](plugins/dev-factory/README.md) (en inglés).

## Demostración

Estos resultados son reales. Se obtienen con:

```bash
node scripts/control.mjs bench
```

El comando crea un repositorio temporal en la rama `main` y ejecuta cada protección igual que lo haría Claude Code.

| El agente intenta | Resultado | Lo que el agente recibe |
|---|---|---|
| `git commit -m "quick fix"` en `main` | 🛑 Bloqueado | `"main" is a protected branch. Work on a feat/, fix/ or hotfix/ branch` |
| `git push origin main` | 🛑 Bloqueado | `Pushing to protected branch "main" is forbidden. Open a PR` |
| `git commit --no-verify` | 🛑 Bloqueado | `--no-verify is forbidden: the git hooks enforce the branch policy` |
| `git config core.hooksPath /dev/null` | 🛑 Bloqueado | `Changing core.hooksPath is forbidden` |
| `rm -rf .githooks` | 🛑 Bloqueado | `.githooks enforces the branch and commit policy. Agents cannot change it` |
| Editar `.githooks/pre-commit` | 🛑 Bloqueado | `Agents cannot change it: ask the human to edit it` |
| Commit con `Co-Authored-By: Claude` | 🛑 Bloqueado | `AI attribution is forbidden in commits, remove this line` |
| `git status` | ✅ Permitido | (nada) |
| `npm test` | ✅ Permitido | (nada) |
| `echo done > notes.txt` | ✅ Permitido | (nada) |
| Editar `src/app.js` | ✅ Permitido | (nada) |
| Commit con mensaje `feat: add login` | ✅ Permitido | (nada) |

Al recibir el motivo, el agente se corrige solo: crea una rama `feat/` en vez de insistir.

<details>
<summary>Salida completa del comando</summary>

```text
ok   BLOCK  54ms  branch-guard      git commit -m "quick fix"
       -> Branch policy: git commit blocked: "main" is a protected branch. Work on a feat/, fix/ or hotfix/ branch: git switch -c feat/<name>
ok   BLOCK  52ms  branch-guard      git push origin main
       -> Branch policy: git push blocked: Pushing to protected branch "main" is forbidden. Open a PR from a feat/, fix/ or hotfix/ branch instead.
ok   BLOCK  54ms  branch-guard      git commit --no-verify -m "skip hooks"
       -> Branch policy: --no-verify is forbidden: the git hooks enforce the branch policy.
ok   BLOCK  52ms  branch-guard      git config core.hooksPath /dev/null
       -> Branch policy: Changing core.hooksPath is forbidden: it would disable the branch policy.
ok   allow  55ms  branch-guard      git status
ok   allow  56ms  branch-guard      npm test
ok   BLOCK  43ms  path-guard        rm -rf .githooks
       -> dev-factory: <repo>/.githooks enforces the branch and commit policy. Agents cannot change it: ask the human to edit it.
ok   allow  39ms  path-guard        echo done > notes.txt
ok   BLOCK  39ms  path-guard        Edit .githooks/pre-commit
       -> dev-factory: .githooks/pre-commit enforces the branch and commit policy. Agents cannot change it: ask the human to edit it.
ok   allow  38ms  path-guard        Edit src/app.js
ok   BLOCK  66ms  attribution-guard commit message ending in "Co-Authored-By: Claude <noreply@anthropic.com>"
       -> Commit policy: AI attribution is forbidden in commits, remove this line: "Co-Authored-By: Claude <noreply@anthropic.com>"
ok   allow  66ms  attribution-guard commit message ending in "feat: add login"

median of 20 runs per case, node 26.13.0
```

El comando termina con error si alguna protección da el veredicto equivocado.

</details>

## Rendimiento

**¿Cuánto frena al agente?** Unas 50 milésimas de segundo por acción. Un parpadeo dura el doble.

Cada bloque `█` son 5 ms:

| Qué se mide | Tiempo | |
|---|---|---|
| Arrancar Node sin hacer nada (referencia) | 34 ms | `███████` |
| `path-guard` en cada comando o edición | 38–43 ms | `████████` |
| `branch-guard` en cada comando | 52–56 ms | `███████████` |
| `attribution-guard` en cada commit | 66 ms | `█████████████` |

Cómo leerlo:

- **Casi todo el tiempo es Node arrancando** (34 ms). La revisión en sí suma entre 5 y 30 ms.
- **Un comando paga dos revisiones** (`branch-guard` y `path-guard`). Una edición paga una.
- **Los tests al terminar cuestan lo que cuesten tus tests.** Con el árbol limpio se ejecutan una vez por commit y después se omiten.

Otros datos:

| Dato | Valor |
|---|---|
| Tokens que gasta una revisión que permite la acción | 0 |
| Tests del plugin | 260, todos en verde, en 6 segundos |
| Dependencias | 0 |

Medido en un Apple M1 Pro con Node 26.13.0, mediana de 20 ejecuciones. Para repetirlo: `node scripts/control.mjs bench` (con `--json` para los datos crudos).

> **Lo que no está medido:** si los agentes escriben mejor código, ni cuántos tokens ahorra delegar en Haiku y Sonnet. Depende del modelo y de la tarea, y este repositorio todavía no tiene cómo medirlo.

## Contribuir

Leer [AGENTS.md](AGENTS.md) y ejecutar:

```bash
node scripts/control.mjs doctor
```

```bash
node scripts/control.mjs verify
```

Los commits van solo en ramas `feat/`, `fix/` o `hotfix/`. Los cambios llegan a las ramas protegidas por pull request.
