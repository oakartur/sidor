ALTER TABLE "vlans"
  ADD COLUMN "escopo_dhcp" TEXT NOT NULL DEFAULT 'DHCP',
  ALTER COLUMN "dhcp_inicio" DROP NOT NULL,
  ALTER COLUMN "dhcp_fim" DROP NOT NULL;

ALTER TABLE "template_vlans"
  ADD COLUMN "escopo_dhcp" TEXT NOT NULL DEFAULT 'DHCP',
  ALTER COLUMN "dhcp_inicio" DROP NOT NULL,
  ALTER COLUMN "dhcp_fim" DROP NOT NULL;

UPDATE "vlans"
SET "escopo_dhcp" = 'DHCP'
WHERE "escopo_dhcp" IS NULL;

UPDATE "template_vlans"
SET "escopo_dhcp" = 'DHCP'
WHERE "escopo_dhcp" IS NULL;

UPDATE "template_vlans"
SET "escopo_dhcp" = 'IP_FIXO',
    "dhcp_inicio" = NULL,
    "dhcp_fim" = NULL
WHERE "dblabel" = 'PADRAO'
  AND "vlan_id" = 1;

UPDATE "template_vlans"
SET "escopo_dhcp" = 'DHCP_RELAY',
    "dhcp_inicio" = NULL,
    "dhcp_fim" = NULL
WHERE "dblabel" = 'PADRAO'
  AND "vlan_id" = 5;
