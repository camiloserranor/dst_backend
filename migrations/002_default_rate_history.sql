-- R-PAY-5: default hourly rates get a history, so changing one never re-prices past hours.
--
-- NOT YET APPLIED. Run after taking a backup. Verify column types against the real
-- Empleado table first (codigo assumed INT, rate assumed DECIMAL/DOUBLE).
--
-- Cut-over note: while the OLD app is still in use, it edits Empleado.rate directly and
-- will not write here. Either stop changing default rates in the old app after this runs,
-- or re-run the backfill below (after deleting the backfilled rows) at cut-over.

CREATE TABLE TarifaEmpleado (
  codigo          INT AUTO_INCREMENT PRIMARY KEY,
  codigo_empleado INT            NOT NULL,
  valor           DECIMAL(10, 2) NOT NULL,
  fecha_inicio    DATE           NOT NULL,
  fecha_fin       DATE           NULL COMMENT 'inclusive; NULL = current rate',
  creado_en       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_tarifa_empleado (codigo_empleado, fecha_inicio),
  CONSTRAINT fk_tarifa_empleado FOREIGN KEY (codigo_empleado) REFERENCES Empleado (codigo),
  CONSTRAINT ck_tarifa_periodo CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
  CONSTRAINT ck_tarifa_valor CHECK (valor >= 0)
);

-- Backfill: today's default rate becomes one open-ended period covering all history.
-- (There is no record of earlier default rates, so past months keep being priced with the
-- current one, exactly as today. From now on, changes only apply forward.)
INSERT INTO TarifaEmpleado (codigo_empleado, valor, fecha_inicio, fecha_fin)
SELECT codigo, rate, '2000-01-01', NULL
FROM Empleado
WHERE rate IS NOT NULL;
