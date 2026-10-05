-- The platform marketing admin role now carries campaigns.approve (docs/ONAYLAR.md).
-- Locked platform roles mirror code; this brings existing ones in line without a console re-sync.
INSERT INTO "role_template_permissions" ("roleTemplateId", "permissionKey")
SELECT "id", 'campaigns.approve' FROM "role_templates" WHERE "systemKey" = 'platform:marketing_admin'
ON CONFLICT DO NOTHING;
