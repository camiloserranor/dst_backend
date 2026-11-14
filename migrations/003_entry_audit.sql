-- R-HRS-11: every change to an existing time entry (Registro) is recorded.
--
-- NOT YET APPLIED. Run after taking a backup.
-- The app only ever INSERTs here. For a log that even the app can't alter, give the
-- backend's DB user INSERT and SELECT on this table, but not UPDATE or DELETE.

CREATE TABLE AuditoriaRegistro (
  codigo            BIGINT AUTO_INCREMENT PRIMARY KEY,
  codigo_registro   INT          NOT NULL COMMENT 'Registro.codigo of the changed entry',
  accion            VARCHAR(16)  NOT NULL COMMENT 'update | delete (if deletes are ever allowed)',
  codigo_autor      INT          NOT NULL COMMENT 'Empleado.codigo of who made the change',
  via               VARCHAR(16)  NOT NULL COMMENT 'web | mcp',
  antes             JSON         NOT NULL COMMENT 'entry values before the change',
  despues           JSON         NULL     COMMENT 'entry values after the change (NULL for delete)',
  creado_en         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_auditoria_registro (codigo_registro),
  INDEX ix_auditoria_autor (codigo_autor, creado_en),
  CONSTRAINT fk_auditoria_autor FOREIGN KEY (codigo_autor) REFERENCES Empleado (codigo)
);
