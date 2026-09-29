#!/usr/bin/env bash
# Hook Stop: antes de que Claude dé por terminado un prompt que dejó cambios
# sin pushear, le pide correr los subagentes de seguridad (revisor-seguridad y
# security-auditor) sobre esos cambios y arreglar lo que encuentren.
#
# - Sin cambios (árbol limpio y nada sin pushear) no hace nada: una pregunta
#   suelta no paga el costo de la revisión.
# - Guarda una huella del diff: la misma huella ya revisada deja terminar; si el
#   arreglo cambia el diff, se vuelve a revisar.
# - Tope de MAX_BLOQUEOS seguidos dentro del mismo prompt para no entrar en loop.
#
# Sólo bash, git y sha256sum, para que corra igual local y en la nube.
set -uo pipefail

MAX_BLOQUEOS=3
entrada=$(cat)
raiz=${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}
[ -n "$raiz" ] && cd "$raiz" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

estado=.claude/.validacion-seguridad

# stop_hook_active=true: Claude ya siguió trabajando por un hook Stop en este
# mismo prompt. Si es false, arranca un prompt nuevo y el contador vuelve a 0.
if printf '%s' "$entrada" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  continuacion=1
else
  continuacion=0
fi

rama=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
base=$(git rev-parse --verify -q "origin/$rama" 2>/dev/null \
  || git merge-base HEAD origin/main 2>/dev/null \
  || git rev-parse --verify -q HEAD 2>/dev/null)
[ -n "$base" ] || exit 0

diff_rastreado=$(git diff "$base" 2>/dev/null)
# El archivo de estado nunca cuenta como cambio, esté o no en .gitignore.
# core.quotePath=true: los nombres salen siempre en ASCII (acentos escapados),
# así el mensaje de abajo es JSON válido con cualquier configuración de git.
nuevos=$(git -c core.quotePath=true ls-files --others --exclude-standard -- . ":!$estado" 2>/dev/null)
if [ -z "$diff_rastreado" ] && [ -z "$nuevos" ]; then
  exit 0
fi

huella=$(
  {
    printf '%s\n' "$diff_rastreado"
    # -z: nombres crudos, sin comillas de git, para que un archivo con acentos
    # o comillas en el nombre también entre a la huella con su contenido.
    git ls-files -z --others --exclude-standard -- . ":!$estado" 2>/dev/null \
      | while IFS= read -r -d '' archivo; do
          [ -f "$archivo" ] && sha256sum -- "$archivo"
        done
  } | sha256sum | cut -d' ' -f1
)

huella_previa=""
bloqueos=0
if [ -f "$estado" ]; then
  huella_previa=$(sed -n 1p "$estado")
  bloqueos=$(sed -n 2p "$estado")
  [[ "$bloqueos" =~ ^[0-9]+$ ]] || bloqueos=0
fi
[ "$continuacion" -eq 0 ] && bloqueos=0

if [ "$huella" = "$huella_previa" ]; then
  exit 0
fi
if [ "$bloqueos" -ge "$MAX_BLOQUEOS" ]; then
  echo "validar-seguridad: tope de $MAX_BLOQUEOS revisiones seguidas; se deja terminar." >&2
  exit 0
fi

mkdir -p .claude
printf '%s\n%s\n' "$huella" "$((bloqueos + 1))" > "$estado"

archivos=$( { git -c core.quotePath=true diff --name-only "$base" 2>/dev/null; printf '%s\n' "$nuevos"; } | sed '/^$/d' | sort -u | head -40 | tr '\n' ' ')
motivo="Validación de seguridad pendiente: hay cambios sin pushear respecto de ${base:0:12} (${archivos}). Antes de terminar, lanzá EN PARALELO los subagentes 'revisor-seguridad' (vulnerabilidades, lo que marcaría CodeQL) y 'security-auditor' (secretos) sobre esos cambios. Arreglá todo hallazgo HIGH o MEDIUM, volvé a correr los checks del paquete tocado y recién ahí terminá, resumiendo al usuario el veredicto de cada uno. Si los dos dan LIMPIO, terminá sin más cambios."

# El motivo no lleva comillas dobles ni barras invertidas salvo las de los
# nombres de archivo, que se escapan acá para que el JSON sea válido.
motivo_json=$(printf '%s' "$motivo" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
printf '{"decision":"block","reason":"%s"}\n' "$motivo_json"
exit 0
