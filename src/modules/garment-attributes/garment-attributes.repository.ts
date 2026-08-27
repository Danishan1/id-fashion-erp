import { prisma } from "@/core/db/client";

export const GarmentAttributeRepository = {
  brand: prisma.brand,
  category: prisma.category,
  season: prisma.season,
  productFitting: prisma.productFitting,
  productType: prisma.productType,
  design: prisma.design,
  designPattern: prisma.designPattern,
  pattern: prisma.pattern,
  supplierCategory: prisma.supplierCategory,
};
