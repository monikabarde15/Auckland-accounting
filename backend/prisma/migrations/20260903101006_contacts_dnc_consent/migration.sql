-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'REVOKED', 'PENDING', 'EXPIRED');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "consent_status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED';

-- CreateTable
CREATE TABLE "dnc_records" (
    "id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,

    CONSTRAINT "dnc_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "source" TEXT NOT NULL DEFAULT 'WRITTEN_ENGAGEMENT',
    "evidence" TEXT,
    "notes" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by_id" TEXT,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dnc_records_phone_number_key" ON "dnc_records"("phone_number");

-- CreateIndex
CREATE INDEX "dnc_records_phone_number_idx" ON "dnc_records"("phone_number");

-- CreateIndex
CREATE INDEX "dnc_records_is_active_idx" ON "dnc_records"("is_active");

-- CreateIndex
CREATE INDEX "consent_records_contact_id_idx" ON "consent_records"("contact_id");

-- CreateIndex
CREATE INDEX "consent_records_status_idx" ON "consent_records"("status");

-- CreateIndex
CREATE INDEX "contacts_consent_status_idx" ON "contacts"("consent_status");

-- AddForeignKey
ALTER TABLE "dnc_records" ADD CONSTRAINT "dnc_records_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
