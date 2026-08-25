-- Same job_orders_quantity_consistency_check precedent, for job_work_orders'
-- own analogous 3-column cap (received + rejected + damaged <= issued). The
-- app-layer guarded updateMany accumulators are the primary correctness
-- mechanism; this CHECK is the hard backstop against any future direct-SQL
-- mistake bypassing that layer.
ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_quantity_consistency_check"
  CHECK (received_quantity + rejected_quantity + damaged_quantity <= issued_quantity);
