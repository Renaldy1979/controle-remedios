#!/bin/sh
set -e
# Roda uma vez, na criação do volume.
#  - medcuidar_owner: dono do banco e do schema; roda as migrações. Não é superusuário.
#  - medcuidar_app:   papel da aplicação. SEM superusuário e SEM BYPASSRLS: o RLS vale de verdade para ele.
#                     Só tem DML nas tabelas; não cria, altera nem apaga objetos.
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE ROLE medcuidar_owner LOGIN PASSWORD '${OWNER_DB_PASSWORD}' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE medcuidar_app   LOGIN PASSWORD '${APP_DB_PASSWORD}'   NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

ALTER DATABASE ${POSTGRES_DB} OWNER TO medcuidar_owner;
REVOKE ALL ON DATABASE ${POSTGRES_DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO medcuidar_owner, medcuidar_app;

ALTER SCHEMA public OWNER TO medcuidar_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO medcuidar_app;

-- Tabelas e sequências criadas pelo dono ficam acessíveis (DML) ao papel da aplicação.
ALTER DEFAULT PRIVILEGES FOR ROLE medcuidar_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO medcuidar_app;
ALTER DEFAULT PRIVILEGES FOR ROLE medcuidar_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO medcuidar_app;
SQL
