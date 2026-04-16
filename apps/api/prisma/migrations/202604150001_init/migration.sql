CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERADOR', 'LEITURA');

CREATE TABLE "users" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "nome" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'LEITURA',
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "sites" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "codigo_site" TEXT NOT NULL UNIQUE,
  "regional" TEXT NOT NULL,
  "bandeira" TEXT NOT NULL,
  "loja" TEXT NOT NULL,
  "label_site" TEXT NOT NULL,
  "vlan1_cidr" TEXT NOT NULL,
  "ip_switch_inicial" INTEGER NOT NULL DEFAULT 241,
  "endereco" TEXT,
  "observacao" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "vlans" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "vlan_id" INTEGER NOT NULL,
  "vlan_nome" TEXT NOT NULL,
  "rede_cidr" TEXT NOT NULL,
  "dhcp_inicio" TEXT NOT NULL,
  "dhcp_fim" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "tipo_acesso_internet" TEXT NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vlans_site_vlan_unique" UNIQUE ("site_id", "vlan_id"),
  CONSTRAINT "vlans_site_rede_unique" UNIQUE ("site_id", "rede_cidr")
);

CREATE TABLE "site_racks" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "rack_num" INTEGER NOT NULL,
  "local_rack" TEXT NOT NULL,
  "qtd_switches" INTEGER NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_racks_site_rack_unique" UNIQUE ("site_id", "rack_num")
);

CREATE TABLE "equipamentos" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "rack_id" UUID NOT NULL REFERENCES "site_racks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tipo_equipamento" TEXT NOT NULL DEFAULT 'SWITCH',
  "hostname" TEXT NOT NULL,
  "ip_gerenciamento" TEXT NOT NULL,
  "local_rack" TEXT NOT NULL,
  "rack_num" INTEGER NOT NULL,
  "ordem_no_rack" INTEGER NOT NULL,
  "ordem_global" INTEGER NOT NULL,
  "papel_switch" TEXT NOT NULL,
  "observacao" TEXT,
  "editado_manual" BOOLEAN NOT NULL DEFAULT false,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "equipamentos_site_hostname_unique" UNIQUE ("site_id", "hostname"),
  CONSTRAINT "equipamentos_site_ip_unique" UNIQUE ("site_id", "ip_gerenciamento")
);

CREATE TABLE "operadoras" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "nome" TEXT NOT NULL UNIQUE,
  "contato" TEXT,
  "telefone" TEXT,
  "observacao" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "links_internet" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "operadora_id" UUID REFERENCES "operadoras"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "nome_link" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "ip_wan" TEXT,
  "gateway_wan" TEXT,
  "mascara_ou_cidr" TEXT,
  "dns1" TEXT,
  "dns2" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "observacao" TEXT
);

CREATE TABLE "vlan_acesso_internet" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "vlan_id" UUID NOT NULL REFERENCES "vlans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "link_internet_id" UUID NOT NULL REFERENCES "links_internet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "modo_acesso" TEXT NOT NULL,
  "observacao" TEXT,
  CONSTRAINT "vlan_acesso_internet_unique" UNIQUE ("vlan_id", "link_internet_id")
);

CREATE TABLE "ip_reservado_padrao" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "nome_referencia" TEXT NOT NULL,
  "host_offset" INTEGER NOT NULL,
  "descricao" TEXT,
  "tipo_equipamento" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "vlan_ip_reservado" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "vlan_id" UUID NOT NULL REFERENCES "vlans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "ip_reservado_padrao_id" UUID REFERENCES "ip_reservado_padrao"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "ip_real" TEXT NOT NULL,
  "hostname_esperado" TEXT,
  "observacao" TEXT,
  CONSTRAINT "vlan_ip_reservado_unique" UNIQUE ("vlan_id", "ip_real")
);

CREATE TABLE "template_vlans" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "dblabel" TEXT NOT NULL,
  "vlan_id" INTEGER NOT NULL,
  "vlan_nome" TEXT NOT NULL,
  "base_octeto" INTEGER NOT NULL,
  "dhcp_inicio" INTEGER NOT NULL,
  "dhcp_fim" INTEGER NOT NULL,
  "tipo_acesso_internet" TEXT NOT NULL,
  "gateway_template" INTEGER NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "template_vlans_label_vlan_unique" UNIQUE ("dblabel", "vlan_id")
);

CREATE TABLE "template_switch_slots" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "slot_num" INTEGER NOT NULL UNIQUE,
  "sufixo_normal" TEXT NOT NULL,
  "sufixo_r1" TEXT NOT NULL,
  "papel_switch" TEXT NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "auditoria" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "entidade" TEXT NOT NULL,
  "entidade_id" TEXT NOT NULL,
  "acao" TEXT NOT NULL,
  "antes_json" JSONB,
  "depois_json" JSONB,
  "motivo" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "vlans_site_idx" ON "vlans"("site_id");
CREATE INDEX "site_racks_site_idx" ON "site_racks"("site_id");
CREATE INDEX "equipamentos_site_idx" ON "equipamentos"("site_id");
CREATE INDEX "equipamentos_rack_idx" ON "equipamentos"("rack_id");
CREATE INDEX "auditoria_entidade_idx" ON "auditoria"("entidade", "entidade_id");
