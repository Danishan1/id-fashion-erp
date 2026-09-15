-- CreateTable
CREATE TABLE "role_branch_access" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_branch_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "role_branch_access_role_id_branch_id_key" ON "role_branch_access"("role_id", "branch_id");

-- AddForeignKey
ALTER TABLE "role_branch_access" ADD CONSTRAINT "role_branch_access_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_branch_access" ADD CONSTRAINT "role_branch_access_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

