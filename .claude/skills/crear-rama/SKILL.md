---
name: crear-rama
description: Crea una rama de trabajo nueva desde develop con el prefijo que corresponde — bug/ si arregla algo roto, feature/ para todo lo demás — y la publica en origin. Usar siempre que haya que empezar a trabajar en algo nuevo, cuando se pida "creá una rama", "rama nueva", "arrancá con LAU-xx", o se pase un link de un issue de Linear para trabajar.
---

# Crear una rama desde develop

Toda rama de trabajo nace de `develop` (la del remoto, no la local) y lleva un prefijo que dice qué es.

## 1. Elegir el prefijo

- `bug/` — el trabajo **arregla algo que no anda**: el issue de Linear tiene el label Bug, o el pedido habla de arreglar, falla, error, "se rompió", "no anda", "no funciona".
- `feature/` — **todo lo demás**: funcionalidad nueva, mejoras, refactors, docs, configuración, tooling.

Si el pedido dice "arreglar" pero el issue describe funcionalidad nueva (o al revés), manda lo que describe el issue. Si sigue siendo ambiguo, preguntá antes de crear nada.

## 2. Armar el nombre

- Con issue de Linear: `<prefijo>/<id-en-minúsculas>-<slug>`, por ejemplo `feature/lau-13-turnos-grupales` o `bug/lau-21-login-safari`.
- Sin issue: `<prefijo>/<slug>`, por ejemplo `feature/skill-crear-rama`.
- El slug: kebab-case, sin tildes ni ñ (`n`), de 2 a 5 palabras que digan de qué se trata, y el nombre entero de 50 caracteres como mucho.

Si te pasaron un link o un id de Linear, leé el issue con el MCP de Linear (`get_issue`) para sacar título y labels. **No uses** el `gitBranchName` que sugiere Linear: trae el usuario de prefijo y no sigue esta convención.

## 3. Chequear antes de crear

```bash
git status --porcelain                       # si hay cambios sin commitear, frená y preguntá (no stashees por tu cuenta)
git rev-parse --verify --quiet <rama>        # no tiene que existir local
git ls-remote --heads origin <rama>          # ni en el remoto
```

Si la rama ya existe, preguntá si se trabaja sobre ella o se elige otro nombre.

## 4. Crear la rama

```bash
git fetch origin develop
git checkout -b <rama> origin/develop
git branch --unset-upstream                  # checkout -b desde origin/develop deja develop como upstream
```

Siempre desde `origin/develop`: el `develop` local puede estar atrasado. Si el `fetch` falla por red, reintentá hasta 4 veces esperando 2s, 4s, 8s y 16s.

## 5. Publicarla

```bash
git push -u origin <rama>
```

Mismos reintentos ante fallas de red. Nunca pushees a otra rama ni abras un PR si no te lo pidieron.

## 6. Contar qué quedó

Respondé con el nombre de la rama, el commit de `develop` del que salió (`git log --oneline -1`) y, si había issue, su id y título.
