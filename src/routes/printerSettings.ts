import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import type { HonoVariables } from "../context";

const PrinterSettingsPatchSchema = z
  .object({
    printerName: z.string().optional(),
    printerIP: z.string().nullable().optional(),
    printerPort: z.number().int().nullable().optional(),
    paperSize: z.enum(["58mm", "80mm"]).optional(),
    printLogo: z.boolean().optional(),
    printerLogo: z.string().nullable().optional(),
    printCustomerCopy: z.boolean().optional(),
    receiptHeader: z.string().optional(),
    receiptFooter: z.string().optional(),
    showTax: z.boolean().optional(),
    showPaymentMethod: z.boolean().optional(),
    showWatermark: z.boolean().optional(),
    showSequenceNumber: z.boolean().optional(),
    showTableNumber: z.boolean().optional(),
    lastConnectedDeviceAddress: z.string().nullable().optional(),
    lastConnectedDeviceName: z.string().nullable().optional(),
  })
  .passthrough();

export const printerSettingsRoutes = new Hono<{ Variables: HonoVariables }>()
  .use("*", requireAuth)
  .get("/", async (c: any) => {
    const authUser = c.get("authUser")!;
    const rows = (await sql`
      SELECT
        printer_name,
        printer_ip,
        printer_port,
        paper_size,
        print_logo,
        printer_logo,
        print_customer_copy,
        receipt_header,
        receipt_footer,
        show_tax,
        show_payment_method,
        show_watermark,
        show_sequence_number,
        show_table_number,
        last_connected_device_address,
        last_connected_device_name,
        updated_at
      FROM printer_settings
      WHERE tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `) as unknown as any[];
    const r = rows[0];
    return c.json({
      printer: {
        printerName: r?.printer_name ?? "Default Printer",
        printerIP: r?.printer_ip ?? null,
        printerPort: r?.printer_port == null ? null : Number(r.printer_port),
        paperSize: r?.paper_size === "80mm" ? "80mm" : "58mm",
        printLogo: Boolean(r?.print_logo),
        printerLogo: r?.printer_logo ?? null,
        printCustomerCopy: Boolean(r?.print_customer_copy),
        receiptHeader: r?.receipt_header ?? "",
        receiptFooter: r?.receipt_footer ?? "",
        showTax: Boolean(r?.show_tax),
        showPaymentMethod: r?.show_payment_method == null ? true : Boolean(r?.show_payment_method),
        showWatermark: r?.show_watermark == null ? true : Boolean(r?.show_watermark),
        showSequenceNumber: r?.show_sequence_number == null ? true : Boolean(r?.show_sequence_number),
        showTableNumber: r?.show_table_number == null ? true : Boolean(r?.show_table_number),
        lastConnectedDeviceAddress: r?.last_connected_device_address ?? null,
        lastConnectedDeviceName: r?.last_connected_device_name ?? null,
      },
    });
  })
  .patch("/", async (c: any) => {
    const authUser = c.get("authUser")!;
    if (authUser.role === "cashier") return c.json({ error: "FORBIDDEN" }, 403);
    const input = PrinterSettingsPatchSchema.parse(await c.req.json());
    if (Object.keys(input).length === 0) return c.json({ error: "NO_CHANGES" }, 400);

    const id = `printer_${authUser.tenantId}`;
    const rows = (await sql`
      INSERT INTO printer_settings (
        id,
        tenant_id,
        printer_name,
        printer_ip,
        printer_port,
        paper_size,
        print_logo,
        printer_logo,
        print_customer_copy,
        receipt_header,
        receipt_footer,
        show_tax,
        show_payment_method,
        show_watermark,
        show_sequence_number,
        show_table_number,
        last_connected_device_address,
        last_connected_device_name,
        updated_at,
        created_at,
        created_by,
        updated_by,
        updated_seq
      )
      VALUES (
        ${id},
        ${authUser.tenantId},
        ${input.printerName ?? "Default Printer"},
        ${input.printerIP ?? null},
        ${input.printerPort ?? null},
        ${input.paperSize ?? "58mm"},
        ${input.printLogo == null ? 0 : input.printLogo ? 1 : 0},
        ${input.printerLogo ?? null},
        ${input.printCustomerCopy == null ? 0 : input.printCustomerCopy ? 1 : 0},
        ${input.receiptHeader ?? ""},
        ${input.receiptFooter ?? ""},
        ${input.showTax == null ? 0 : input.showTax ? 1 : 0},
        ${input.showPaymentMethod == null ? 1 : input.showPaymentMethod ? 1 : 0},
        ${input.showWatermark == null ? 1 : input.showWatermark ? 1 : 0},
        ${input.showSequenceNumber == null ? 1 : input.showSequenceNumber ? 1 : 0},
        ${input.showTableNumber == null ? 1 : input.showTableNumber ? 1 : 0},
        ${input.lastConnectedDeviceAddress ?? null},
        ${input.lastConnectedDeviceName ?? null},
        now(),
        now(),
        ${authUser.id},
        ${authUser.id},
        1
      )
      ON CONFLICT (id) DO UPDATE SET
        printer_name = COALESCE(${input.printerName ?? null}, printer_settings.printer_name),
        printer_ip = COALESCE(${input.printerIP ?? null}, printer_settings.printer_ip),
        printer_port = COALESCE(${input.printerPort ?? null}, printer_settings.printer_port),
        paper_size = COALESCE(${input.paperSize ?? null}, printer_settings.paper_size),
        print_logo = COALESCE(${input.printLogo == null ? null : input.printLogo ? 1 : 0}, printer_settings.print_logo),
        printer_logo = COALESCE(${input.printerLogo ?? null}, printer_settings.printer_logo),
        print_customer_copy = COALESCE(${input.printCustomerCopy == null ? null : input.printCustomerCopy ? 1 : 0}, printer_settings.print_customer_copy),
        receipt_header = COALESCE(${input.receiptHeader ?? null}, printer_settings.receipt_header),
        receipt_footer = COALESCE(${input.receiptFooter ?? null}, printer_settings.receipt_footer),
        show_tax = COALESCE(${input.showTax == null ? null : input.showTax ? 1 : 0}, printer_settings.show_tax),
        show_payment_method = COALESCE(${input.showPaymentMethod == null ? null : input.showPaymentMethod ? 1 : 0}, printer_settings.show_payment_method),
        show_watermark = COALESCE(${input.showWatermark == null ? null : input.showWatermark ? 1 : 0}, printer_settings.show_watermark),
        show_sequence_number = COALESCE(${input.showSequenceNumber == null ? null : input.showSequenceNumber ? 1 : 0}, printer_settings.show_sequence_number),
        show_table_number = COALESCE(${input.showTableNumber == null ? null : input.showTableNumber ? 1 : 0}, printer_settings.show_table_number),
        last_connected_device_address = COALESCE(${input.lastConnectedDeviceAddress ?? null}, printer_settings.last_connected_device_address),
        last_connected_device_name = COALESCE(${input.lastConnectedDeviceName ?? null}, printer_settings.last_connected_device_name),
        updated_at = now(),
        updated_by = ${authUser.id},
        updated_seq = printer_settings.updated_seq + 1
      WHERE printer_settings.deleted_at IS NULL
      RETURNING
        printer_name,
        printer_ip,
        printer_port,
        paper_size,
        print_logo,
        printer_logo,
        print_customer_copy,
        receipt_header,
        receipt_footer,
        show_tax,
        show_payment_method,
        show_watermark,
        show_sequence_number,
        show_table_number,
        last_connected_device_address,
        last_connected_device_name
    `) as unknown as any[];
    const r = rows[0]!;
    return c.json({
      printer: {
        printerName: r.printer_name ?? "Default Printer",
        printerIP: r.printer_ip ?? null,
        printerPort: r.printer_port == null ? null : Number(r.printer_port),
        paperSize: r.paper_size === "80mm" ? "80mm" : "58mm",
        printLogo: Boolean(r.print_logo),
        printerLogo: r.printer_logo ?? null,
        printCustomerCopy: Boolean(r.print_customer_copy),
        receiptHeader: r.receipt_header ?? "",
        receiptFooter: r.receipt_footer ?? "",
        showTax: Boolean(r.show_tax),
        showPaymentMethod: r.show_payment_method == null ? true : Boolean(r.show_payment_method),
        showWatermark: r.show_watermark == null ? true : Boolean(r.show_watermark),
        showSequenceNumber: r.show_sequence_number == null ? true : Boolean(r.show_sequence_number),
        showTableNumber: r.show_table_number == null ? true : Boolean(r.show_table_number),
        lastConnectedDeviceAddress: r.last_connected_device_address ?? null,
        lastConnectedDeviceName: r.last_connected_device_name ?? null,
      },
    });
  });
