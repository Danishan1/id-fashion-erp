-- AlterTable
ALTER TABLE "replicate_design_projects" ADD COLUMN     "brand_logo_attachment_id" TEXT,
ADD COLUMN     "brand_name" TEXT,
ADD COLUMN     "branded_image_attachment_id" TEXT,
ADD COLUMN     "logo_width_percent" DECIMAL(5,2),
ADD COLUMN     "logo_x_percent" DECIMAL(5,2),
ADD COLUMN     "logo_y_percent" DECIMAL(5,2);
