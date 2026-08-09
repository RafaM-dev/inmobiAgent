#!/bin/sh
# Prepara el disco de datos y baja de privilegios antes de arrancar.
#
# Existe por un detalle de los volúmenes: se montan DESPUÉS de construir la
# imagen y pertenecen a root, así que el `chown` del Dockerfile no los alcanza.
# Un proceso sin privilegios se encontraría un directorio donde no puede
# escribir, y el primer documento que alguien subiera fallaría — en producción,
# no aquí.
#
# El contenedor arranca como root solo para esto y entrega el control a `node`
# de inmediato: la aplicación nunca corre con privilegios.
set -e

dir="${STORAGE_DIR:-/app/.storage}"
mkdir -p "$dir"

# Solo el directorio raíz, no su contenido: lo que haya dentro ya lo escribió
# `node`. Un `-R` sobre un volumen con miles de documentos añadiría segundos a
# cada arranque a cambio de nada.
chown node:node "$dir"

exec su-exec node "$@"
