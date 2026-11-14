-- Links each DST employee to their login at the identity provider.
-- The `sub` claim of the access token is matched against this column; an employee
-- with no idp_subject cannot use the new API or the MCP server.
--
-- NOT YET APPLIED. Run once against the `general` database (e.g. from phpMyAdmin)
-- after taking a backup. Safe to run while the old app is still in use: it only adds
-- a nullable column.

ALTER TABLE Empleado
  ADD COLUMN idp_subject VARCHAR(255) NULL,
  ADD UNIQUE INDEX ux_empleado_idp_subject (idp_subject);

-- After each user's account is created at the identity provider, link it, e.g.:
--   UPDATE Empleado SET idp_subject = 'user_01H...' WHERE username = 'emma';
