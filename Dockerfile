# syntax=docker/dockerfile:1
#
# Imagen de AgentInmobi: API + panel en un solo proceso (D84).
#
# Multi-etapa para que la imagen final no lleve ni compiladores, ni código
# fuente, ni dependencias de desarrollo. Lo que se despliega es lo que se
# ejecuta y nada más: menos superficie que parchear y menos que descargar en
# cada despliegue.

# ---------------------------------------------------------------- base ------
# Node 22 porque es lo que declara `engines` en la raíz. Alpine por tamaño;
# `libc6-compat` lo necesitan los binarios de Prisma, que se compilan contra
# glibc y no contra musl.
FROM node:22-alpine AS base
# `su-exec` lo usa el entrypoint para bajar de privilegios tras preparar el
# disco de datos; sin él habría que elegir entre correr como root o no poder
# escribir en un volumen montado.
RUN apk add --no-cache libc6-compat su-exec
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# pnpm pide confirmación por consola antes de vaciar `node_modules`, y en una
# construcción no hay consola: sin esto la instalación de producción aborta.
ENV CI=true
RUN corepack enable
WORKDIR /repo

# --------------------------------------------------------- dependencias -----
# Solo los manifiestos, antes que el código. Docker cachea esta capa y una
# instalación completa —que tarda minutos— solo se rehace cuando cambian las
# dependencias, no cada vez que se toca una línea de TypeScript.
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config-ts/package.json packages/config-ts/
# `--frozen-lockfile`: si el lock no cuadra con los manifiestos, se para. Una
# imagen que resuelve versiones por su cuenta no es reproducible.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# --------------------------------------------------------------- build ------
FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/contracts/node_modules ./packages/contracts/node_modules
COPY . .

# El cliente de Prisma se genera a partir del schema; sin esto el build falla
# con tipos que no existen todavía.
RUN pnpm --filter @agentinmobi/api db:generate
RUN pnpm --filter @agentinmobi/api build
RUN pnpm --filter @agentinmobi/web build

# Dependencias de producción. `--prod` descarta las de desarrollo (vitest, tsx,
# eslint), que no pintan nada en la imagen final.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @agentinmobi/api...

# El cliente de Prisma se regenera DESPUÉS, y no es una repetición inútil: la
# instalación de producción rehace `node_modules`, que es exactamente donde
# vive el cliente generado. Sin esta segunda pasada la imagen arranca y muere
# al primer acceso a la base.
RUN pnpm --filter @agentinmobi/api db:generate

# ------------------------------------------------------------ runtime -------
FROM base AS runtime
ENV NODE_ENV=production
# El panel se sirve desde este proceso. La ruta la lee `WEB_ROOT` y el arranque
# falla si no encuentra el index.html (D84).
ENV WEB_ROOT=/app/web
# El paso de release invoca `prisma` como ejecutable. Va en `dependencies` (no
# en las de desarrollo) justamente para poder migrar desde dentro del
# contenedor. pnpm coloca los binarios en el `.bin` DEL PAQUETE que los declara,
# no en el de la raíz del workspace.
ENV PATH=/app/apps/api/node_modules/.bin:$PATH
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/packages/contracts ./packages/contracts
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/apps/web/dist ./web

# Las migraciones viajan en la imagen a propósito: la versión del esquema y la
# del código que lo usa tienen que desplegarse juntas, o una de las dos estará
# equivocada. El cliente generado ya va dentro de `node_modules`.
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma

COPY --from=build /repo/ops/docker-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

# La imagen de Node ya trae el usuario `node` (uid 1000). NO se usa `USER node`
# aquí: el entrypoint necesita un instante de root para dar permiso sobre el
# volumen montado, y entrega el control a `node` acto seguido. La aplicación no
# corre nunca con privilegios.
RUN chown -R node:node /app
ENTRYPOINT ["/usr/local/bin/entrypoint"]

EXPOSE 3000

# Sonda de liveness: pregunta si el PROCESO está vivo, no si la base responde.
# Con `/health/ready` un Postgres caído reiniciaría el contenedor en bucle, que
# es justo lo que no arregla un Postgres caído.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Sin migraciones en el arranque: las lanza un paso aparte del despliegue.
# Migrar al arrancar hace que dos instancias levantándose a la vez compitan por
# el mismo `ALTER TABLE`, y el error resultante ocurre una vez de cada diez
# despliegues — la peor frecuencia posible para diagnosticar nada.
CMD ["node", "apps/api/dist/main.js"]
