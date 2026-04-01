# WireGuard Manager

Panel web self-hosted para administrar múltiples servidores WireGuard por SSH, con búsqueda global de peers, revocación masiva, creación de peers, almacenamiento cifrado de credenciales y auditoría de acciones.

## Características principales

- Administración de múltiples servidores WireGuard por SSH
- Soporte para WireGuard ejecutándose directamente en el host o dentro de un contenedor Docker remoto
- Directorio global de peers con filtros por alias, public key, servidor, IP/subred y estado
- Creación de peers con asignación automática de la siguiente IP disponible
- Revocación masiva de peers en varios servidores
- Almacenamiento cifrado de credenciales SSH
- Almacenamiento cifrado de configuraciones cliente generadas desde el dashboard
- Re-descarga de archivos `.conf` solo para peers creados desde la aplicación
- Acceso multiusuario con roles:
  - `admin`: acceso total
  - `operator`: acceso limitado a los servidores asignados
- Registro de auditoría para acciones sobre peers y servidores

## Stack

- Backend: Node.js 22, Fastify 5, TypeScript 5, Drizzle ORM, SQLite, `ssh2`, Zod, JWT
- Frontend: React 19, Vite 6, Tailwind CSS v4, Zustand, TanStack Query/Table/Router, Lucide, Sonner
- Infraestructura: Docker + Docker Compose

## Estructura del proyecto

```text
wg-manager/
├── backend/
├── frontend/
├── .env.example
├── docker-compose.yml
└── README.md
```

## Base de datos

Este proyecto utiliza:

- `SQLite` como base de datos
- `Drizzle ORM` como ORM
- `better-sqlite3` como driver

En Docker, la base se almacena como archivo, por ejemplo en `/data/wg-manager.db`.

## Variables de entorno

`docker-compose.yml` no incluye valores por defecto. Todos los valores requeridos deben existir en un archivo `.env` en la raíz del proyecto.

Primero copie el ejemplo:

```bash
cp .env.example .env
```

Después complete todas las variables en `.env`.

### Variables obligatorias

- `NODE_ENV`
- `BACKEND_CONTAINER_NAME`
- `BACKEND_HOST`
- `BACKEND_PORT`
- `BACKEND_BIND_IP`
- `FRONTEND_CONTAINER_NAME`
- `FRONTEND_PORT`
- `FRONTEND_BIND_IP`
- `DATABASE_URL`
- `CORS_ORIGIN`
- `VITE_API_BASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

### Ejemplo de `.env`

```env
NODE_ENV=production

BACKEND_CONTAINER_NAME=wg-manager-backend
BACKEND_HOST=0.0.0.0
BACKEND_PORT=3001
BACKEND_BIND_IP=127.0.0.1

FRONTEND_CONTAINER_NAME=wg-manager-frontend
FRONTEND_PORT=5173
FRONTEND_BIND_IP=127.0.0.1

DATABASE_URL=/data/wg-manager.db
CORS_ORIGIN=http://localhost:5173
VITE_API_BASE_URL=http://localhost:3001/api

JWT_SECRET=reemplace-esto-por-un-secreto-largo
ENCRYPTION_KEY=reemplace-esto-por-una-clave-estable-para-cifrado
ADMIN_USERNAME=admin
ADMIN_PASSWORD=reemplace-esto-por-una-clave-segura
```

Importante:

- Mantenga `ENCRYPTION_KEY` estable después del primer uso. Si la cambia más adelante, las credenciales SSH y las configuraciones cliente guardadas previamente dejarán de poder descifrarse.
- El backend y el frontend están pensados para enlazarse a `127.0.0.1` y publicarse externamente a través de un reverse proxy como Nginx.

## Inicio rápido

```bash
docker compose up --build
```

Abra:

- Frontend: `http://localhost:5173`
- Health del backend: `http://localhost:3001/health`

Si falta una variable o está vacía, Compose fallará inmediatamente.

## Primer arranque

1. Cree y complete el archivo `.env`.
2. Inicie el stack con `docker compose up --build`.
3. Inicie sesión con `ADMIN_USERNAME` y `ADMIN_PASSWORD`.
4. Abra `Servers` y registre un servidor WireGuard.
5. Pruebe la conectividad SSH antes de guardar.
6. Elija cómo se ejecuta WireGuard en esa máquina:
   - `Host`
   - `Docker`, indicando además el nombre del contenedor remoto
7. Defina la interfaz WireGuard, por ejemplo `wg0`.
8. Opcionalmente configure:
   - host público del endpoint
   - puerto público del endpoint
   - límite de peers
9. Guarde el servidor. Los peers existentes se descubrirán y se almacenarán en la base local.
10. Abra `Peers` para buscar globalmente, crear peers, editar alias/notas, descargar configuraciones guardadas y revocar peers.
11. Abra `Users` para crear operadores y asignarles qué servidores VPN pueden gestionar.
12. Abra `Audit` para revisar acciones y resultados.

## Estados de peers

La interfaz evita afirmar una conexión exacta en tiempo real porque WireGuard expone handshakes recientes, no una señal perfecta de online/offline.

- `Healthy`: el servidor vio un handshake reciente
- `Quiet`: el peer se conectó antes, pero no recientemente
- `Never established`: no hay handshakes registrados para ese peer
- `Unavailable`: no se pudo consultar el estado live desde el servidor WireGuard

## Creación de peers y descargas

Cuando un peer se crea desde el dashboard:

- se asigna automáticamente la siguiente IP `/32` disponible
- se aplica en caliente con `wg set`
- la configuración del servidor se persiste con `wg-quick save`
- la configuración cliente generada se guarda cifrada en la base local

Esto permite descargar más tarde el archivo `.conf` desde la web.

Limitación importante:

- los peers creados fuera del dashboard no tienen una private key recuperable
- esos peers importados pueden gestionarse y revocarse, pero su configuración cliente no puede descargarse después

## Roles y control de acceso

- `admin`
  - acceso completo a servidores, peers, usuarios y auditoría
- `operator`
  - solo puede acceder a los servidores VPN explícitamente asignados
  - solo puede ver peers y auditoría de esos servidores asignados

Si se crea un `operator`, debe tener al menos un servidor asignado.

## Desarrollo local

Backend:

```bash
cd backend
npm install
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Base de datos y seed

Scripts del backend:

```bash
cd backend
npm install
npm run db:migrate
npm run seed
```

El seed es útil cuando todavía no hay acceso SSH real. Crea:

- esquema/tablas si no existen
- usuario admin inicial si no existe
- servidor demo
- metadata de peers de ejemplo
- registros de auditoría de ejemplo

## Notas de seguridad

- Las contraseñas SSH y claves privadas se cifran antes de guardarse.
- Las configuraciones cliente generadas desde el dashboard también se cifran antes de guardarse.
- Las credenciales SSH en bruto nunca se devuelven por la API.
- Todas las rutas de la API están protegidas por JWT, salvo auth y health.
- La revocación requiere confirmación explícita en la UI.
- Utilice un `ENCRYPTION_KEY` estable y un `JWT_SECRET` robusto.

## Notas sobre el límite de peers

WireGuard no expone un máximo fijo de peers por servidor. En este proyecto, `Peer limit` es una protección operativa configurable por servidor desde el dashboard. Si está definido, la aplicación bloquea la creación de más peers al alcanzar ese límite.

## Subida a GitHub por SSH

Si desea publicar el proyecto en un repositorio privado por SSH:

1. Cree el repositorio vacío en GitHub.
2. Configure el remoto:

```bash
git remote add origin git@github.com:SU_USUARIO/wireguard-admin-dashboard.git
```

3. Suba la rama principal:

```bash
git push -u origin main
```

## Resumen de API

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/servers`
- `POST /api/servers`
- `PATCH /api/servers/:id`
- `DELETE /api/servers/:id`
- `POST /api/servers/test-connection`
- `POST /api/servers/:id/test`
- `GET /api/servers/:id/peers`
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`
- `GET /api/peers`
- `POST /api/peers`
- `GET /api/peers/:id`
- `GET /api/peers/:id/config`
- `PATCH /api/peers/:id`
- `DELETE /api/peers/bulk`
- `GET /api/audit`
