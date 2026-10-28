---
name: crear-rama
description: Crea una rama de trabajo nueva desde develop (siempre la del remoto, origin/develop) con el prefijo que corresponde — bug/ si arregla algo roto, feature/ para todo lo demás — y la publica en origin. Usar siempre que haya que empezar algo nuevo, sea lo que sea: una funcionalidad, una mejora, un arreglo, un refactor, docs o tooling; cuando se pase un link o id de Linear (LAU-xx) o sólo una descripción; cuando se abra un chat nuevo para trabajar; o cuando se pida "creá una rama", "rama nueva", "arrancá con…", "quiero sumar…", "atacá el issue…".
---

# Crear una rama desde develop

Todo trabajo nuevo nace de `develop` y vive en su propia rama. Eso vale para cualquier pedido y para cada chat nuevo: un chat que empieza a trabajar en algo arranca desde `origin/develop`, nunca desde la rama de otro chat ni desde `main`.

## 0. Qué te pasaron

El pedido puede llegar de tres formas. Las tres pasan por los mismos pasos:

- **Link o id de Linear** (`https://linear.app/…/issue/LAU-31/…` o `LAU-31`): leé el issue con `get_issue` (cargá la herramienta con ToolSearch si no está) y sacá id, título y labels. Si hay un link de Linear, el id es lo que sigue a `/issue/`.
- **Sólo una descripción** ("quiero sumar exportación a CSV de clientes"): no hay issue. Sigue sin ser un motivo para parar: armá el nombre con la descripción.
- **Un arreglo o un pedido mixto**: decidí por lo que el trabajo *entrega*, no por cómo lo llamaron.

**No uses** el `gitBranchName` que sugiere Linear: trae el usuario de prefijo (`cologonzalez49/…`) y no sigue esta convención.

## 1. Elegir el prefijo

- `bug/` — el trabajo **arregla algo que no anda**: el issue tiene el label Bug, o el pedido habla de arreglar, falla, error, "se rompió", "no anda", "no funciona".
- `feature/` — **todo lo demás**: funcionalidad nueva, mejoras, refactors, docs, configuración, tooling. Un issue con label Feature es `feature/` aunque mencione "mejorar".

Si el pedido dice "arreglar" pero el issue describe funcionalidad nueva (o al revés), manda lo que describe el issue. Si sigue siendo ambiguo, preguntá antes de crear nada.

## 2. Armar el nombre

- Con issue de Linear: `<prefijo>/<id-en-minúsculas>-<slug>`. Ejemplo: `feature/lau-13-turnos-grupales`, `bug/lau-21-login-safari`.
- Sin issue: `<prefijo>/<slug>`. Ejemplo: `feature/exportar-clientes-csv`.
- El slug: kebab-case, sin tildes ni ñ (`n`), de 2 a 5 palabras que digan de qué se trata. Sacá las palabras de relleno ("de", "para", "desde", "con") salvo que hagan falta para entenderlo.
- El nombre entero no pasa de 50 caracteres. Si el título del issue es largo, acortá el slug, no el id.

Ejemplo real: LAU-31 "Agregar importación rápida de productos desde Mercado Libre, Tiendamia y sitios web" tiene label Feature, así que el nombre es `feature/lau-31-importacion-productos-mercado-libre` (49 caracteres).

## 3. Chequear antes de crear

Antes de usar el nombre en un comando, validalo: tiene que cumplir `^(bug|feature)/[a-z0-9]+(-[a-z0-9]+)*$`. Si no, corregilo con las reglas del paso 2. Siempre escribilo entre comillas.

```bash
git status --porcelain                       # si hay cambios sin commitear, frená y preguntá (no stashees por tu cuenta)
git rev-parse --verify --quiet "<rama>"      # no tiene que existir local
git ls-remote --heads origin "<rama>"        # ni en el remoto
```

Si la rama ya existe, preguntá si se trabaja sobre ella o se elige otro nombre. Nunca reutilices en silencio una rama de otro trabajo.

## 4. Crear la rama desde develop

```bash
git fetch origin develop
git checkout -b "<rama>" origin/develop     # -b falla si la rama ya existe: nunca la resetea
git branch --unset-upstream                  # checkout desde origin/develop deja develop como upstream
```

- Siempre desde `origin/develop`: el `develop` local puede estar atrasado o tener commits propios.
- Nunca uses `-B` ni `--force`: pueden reescribir una rama con trabajo sin publicar.
- Si el `fetch` falla por red, reintentá hasta 4 veces esperando 2s, 4s, 8s y 16s.
- Si la rama ya tiene commits que no están en `origin/develop` y no los esperabas, frená y preguntá antes de tocarla.

## 5. Publicarla

```bash
git push -u origin "<rama>"
```

Mismos reintentos ante fallas de red. No pushees a otra rama y no abras un PR si no te lo pidieron.

## 6. Trabajar sobre ella

- Todo el trabajo de este chat se commitea en esa rama. Si el pedido cambia de tema, creá otra rama desde develop en vez de seguir sobre ésta.
- Si el chat ya tiene una rama de un trabajo anterior que no terminó, no la reemplaces: preguntá si el pedido nuevo es continuación o es un trabajo aparte.

## 7. Contar qué quedó

Respondé con:

- El nombre de la rama y que quedó publicada en origin.
- El commit de `develop` del que salió (`git log --oneline -1 origin/develop`).
- Si había issue, su id, título y label con el que se eligió el prefijo.
