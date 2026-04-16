ALTER TABLE "site_racks"
  ADD COLUMN "altura_u" INTEGER,
  ADD COLUMN "label_export" TEXT;

ALTER TABLE "links_internet"
  ADD COLUMN "rede_operadora" TEXT,
  ADD COLUMN "ip_mikrotik" TEXT,
  ADD COLUMN "ip_operadora" TEXT,
  ADD COLUMN "velocidade" TEXT,
  ADD COLUMN "interface_nome" TEXT,
  ADD COLUMN "ordem_exportacao" INTEGER;

ALTER TABLE "vlan_ip_reservado"
  ADD COLUMN "tipo_reserva" TEXT NOT NULL DEFAULT 'IP_UNICO',
  ADD COLUMN "ip_fim" TEXT,
  ADD COLUMN "mac" TEXT,
  ALTER COLUMN "ip_real" DROP NOT NULL;

CREATE TABLE "switch_ports" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "equipamento_id" UUID NOT NULL REFERENCES "equipamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "vlan_id" UUID REFERENCES "vlans"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "porta_num" INTEGER NOT NULL,
  "descricao" TEXT,
  "status" TEXT NOT NULL DEFAULT 'VAGO',
  "observacao" TEXT,
  "ordem" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "switch_ports_equipamento_porta_unique" UNIQUE ("equipamento_id", "porta_num")
);

CREATE TABLE "patch_panels" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "rack_id" UUID REFERENCES "site_racks"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "nome" TEXT NOT NULL,
  "rack_num" INTEGER,
  "descricao" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patch_panels_site_nome_unique" UNIQUE ("site_id", "nome")
);

CREATE TABLE "patch_panel_ports" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "patch_panel_id" UUID NOT NULL REFERENCES "patch_panels"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "switch_port_id" UUID REFERENCES "switch_ports"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "porta_num" INTEGER NOT NULL,
  "descricao" TEXT,
  "observacao" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patch_panel_ports_panel_porta_unique" UNIQUE ("patch_panel_id", "porta_num")
);

CREATE TABLE "site_interfaces" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "vlan_id" UUID REFERENCES "vlans"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "link_internet_id" UUID REFERENCES "links_internet"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "nome" TEXT NOT NULL,
  "descricao" TEXT,
  "ip_cidr" TEXT,
  "gateway" TEXT,
  "tipo" TEXT NOT NULL DEFAULT 'MIKROTIK',
  "ordem" INTEGER,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_interfaces_site_nome_unique" UNIQUE ("site_id", "nome")
);

CREATE TABLE "telefonia_site" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL UNIQUE REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "titulo" TEXT,
  "modelo" TEXT,
  "tipo" TEXT,
  "ip" TEXT,
  "senha_ramais" TEXT,
  "observacao" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "telefonia_ramais" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "telefonia_site_id" UUID NOT NULL REFERENCES "telefonia_site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "local" TEXT NOT NULL,
  "ramal" TEXT NOT NULL,
  "liberacao" TEXT NOT NULL,
  "observacao" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telefonia_ramais_site_ramal_unique" UNIQUE ("telefonia_site_id", "ramal")
);
