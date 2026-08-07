-- Row Level Security: la tercera capa de aislamiento entre inmobiliarias.
--
-- Las dos primeras (TenantContext y tenantScope() en cada repositorio) dependen
-- de que el código no se olvide. Ya se demostró que puede olvidarse: un
-- findById sin ámbito sobrevivió seis fases. Esta capa no depende de nadie.
--
-- Tres detalles sin los cuales esto sería decorativo:
--
--  1. FORCE ROW LEVEL SECURITY. Sin él, el DUEÑO de la tabla se salta la
--     política — y la aplicación se conecta con el usuario que creó las tablas.
--     ENABLE a secas habría dado una falsa sensación de seguridad perfecta.
--
--  2. La política FALLA CERRADA. Si nadie fijó app.tenant_id, current_setting
--     devuelve NULL, la comparación es NULL (no TRUE) y no se ve ni una fila.
--     Un olvido produce cero resultados, nunca los de otra inmobiliaria.
--
--  3. El comodín '*' permite el acceso entre inmobiliarias, y por eso hay que
--     escribirlo. Lo usa el seed y las tareas de mantenimiento. Que sea
--     explícito y buscable es justo la propiedad que se quiere: cruzar la
--     frontera es posible, pero nunca por accidente.

ALTER TABLE "agent_run_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_run_steps" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_run_steps"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_runs"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "appointment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "appointment_events"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "appointments"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "channel_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channel_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "channel_deliveries"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "contact_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_identities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contact_identities"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "contact_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contact_profiles"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contacts"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversations"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "document_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_chunks"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "documents"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "knowledge_collections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_collections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "knowledge_collections"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "lead_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lead_events"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "lead_property_interests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_property_interests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lead_property_interests"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leads"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "messages"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "profile_facts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile_facts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "profile_facts"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "property_impressions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_impressions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "property_impressions"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "property_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "property_snapshots"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE "tenant_usage_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_usage_periods" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_usage_periods"
  USING (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    current_setting('app.tenant_id', TRUE) = '*'
    OR tenant_id = current_setting('app.tenant_id', TRUE)
  );
