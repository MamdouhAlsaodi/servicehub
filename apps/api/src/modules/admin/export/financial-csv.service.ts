/**
 * Phase B5 — Admin financial CSV export service.
 *
 * Streams every SUCCEEDED payment joined to its booking, vendor, and
 * customer. Prisma cursor pagination keeps memory use O(batchSize)
 * regardless of dataset size.
 *
 * Safety: RFC 4180 quoting (double-quotes wrap every cell, embedded
 * quotes are doubled); spreadsheet-formula escape (cells starting
 * with `= + - @ \t \r` get a leading apostrophe); no PII beyond
 * IDs/names/emails/amounts/currency/succeeded timestamp.
 *
 * BOM policy: NOT emitted. First byte is `p` from `payment_id`.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/modules/prisma/prisma.service';
import {
  FINANCIAL_EXPORT_DEFAULT_BATCH_SIZE,
  FINANCIAL_EXPORT_MAX_BATCH_SIZE,
  FinancialExportQueryDto,
} from '../dto/financial-export-query.dto';

/** Deterministic column order — never reorder without bumping the
 *  format version in the filename. */
export const FINANCIAL_CSV_HEADERS = [
  'payment_id',
  'booking_id',
  'paid_at',
  'amount',
  'currency',
  'refunded_amount',
  'commission_amount',
  'vendor_id',
  'vendor_name',
  'vendor_email',
  'customer_id',
  'customer_name',
  'customer_email',
] as const;

/** Characters that can start a spreadsheet formula. */
const FORMULA_LEADING = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Type of a single SUCCEEDED payment row from the internal findMany. */
type FinancialRow = Prisma.PaymentGetPayload<{
  select: {
    id: true;
    updatedAt: true;
    amount: true;
    currency: true;
    refundedAmount: true;
    booking: {
      select: {
        id: true;
        commissionAmount: true;
        customer: { select: { id: true; name: true; email: true } };
        vendor: {
          select: {
            id: true;
            businessName: true;
            user: { select: { email: true } };
          };
        };
      };
    };
  };
}>;

@Injectable()
export class FinancialCsvExportService {
  /** Quoted-and-joined header row, computed once and reused for every export. */
  static readonly HEADER_ROW =
    FINANCIAL_CSV_HEADERS.map((h) => escapeCell(h)).join(',');

  /** Documented BOM policy. `false` ⇒ the first byte is `p` from `payment_id`. */
  static readonly USE_BOM = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Throw on bad cross-field input BEFORE the HTTP layer writes any header. */
  validateQuery(query: FinancialExportQueryDto): void {
    this.assertDateRange(query);
  }

  /**
   * Async-iterable CSV chunks. Header first, then one data row each.
   * Memory use is O(batchSize), not O(total rows).
   */
  async *streamFinancialCsv(
    query: FinancialExportQueryDto,
  ): AsyncGenerator<string, void, void> {
    this.assertDateRange(query);

    const batchSize = this.resolveBatchSize(query.batchSize);
    const where: Prisma.PaymentWhereInput = {
      status: PaymentStatus.SUCCEEDED,
      ...this.buildDateFilter(query),
    };

    /* Header row (CSV convention: CRLF terminator). */
    yield FinancialCsvExportService.HEADER_ROW + '\r\n';

    /* Cursor pagination: over-fetch by 1 so we know if another page
     * exists without a separate COUNT query. */
    let cursor: string | null = null;
    while (true) {
      const rows: FinancialRow[] = await this.prisma.payment.findMany({
        where,
        take: batchSize + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          updatedAt: true,
          amount: true,
          currency: true,
          refundedAmount: true,
          booking: {
            select: {
              id: true,
              commissionAmount: true,
              customer: {
                select: { id: true, name: true, email: true },
              },
              vendor: {
                select: {
                  id: true,
                  businessName: true,
                  user: { select: { email: true } },
                },
              },
            },
          },
        },
      });

      if (rows.length === 0) break;

      const hasMore = rows.length > batchSize;
      const page = hasMore ? rows.slice(0, batchSize) : rows;

      for (const row of page) {
        yield this.formatRow(row) + '\r\n';
      }

      if (!hasMore) break;
      cursor = page[page.length - 1]!.id;
    }
  }

  /** Deterministic filename for Content-Disposition. */
  buildFilename(now: Date = new Date()): string {
    const ts = now.toISOString().slice(0, 19).replace(/[T:]/g, '-');
    return `servicehub-financial-${ts}.csv`;
  }

  /* ─────────────── internals ─────────────── */

  private resolveBatchSize(input: number | undefined): number {
    if (input === undefined) return FINANCIAL_EXPORT_DEFAULT_BATCH_SIZE;
    if (!Number.isFinite(input) || input < 1) {
      return FINANCIAL_EXPORT_DEFAULT_BATCH_SIZE;
    }
    return Math.min(Math.floor(input), FINANCIAL_EXPORT_MAX_BATCH_SIZE);
  }

  private buildDateFilter(
    query: FinancialExportQueryDto,
  ): Prisma.PaymentWhereInput {
    const hasFrom = typeof query.from === 'string' && query.from.length > 0;
    const hasTo = typeof query.to === 'string' && query.to.length > 0;
    if (!hasFrom && !hasTo) return {};
    return {
      updatedAt: {
        ...(hasFrom ? { gte: new Date(query.from!) } : {}),
        ...(hasTo ? { lte: new Date(query.to!) } : {}),
      },
    };
  }

  private assertDateRange(query: FinancialExportQueryDto): void {
    if (query.from) {
      const from = new Date(query.from);
      if (Number.isNaN(from.getTime())) {
        throw new BadRequestException('Invalid `from` date');
      }
      if (query.to) {
        const to = new Date(query.to);
        if (Number.isNaN(to.getTime())) {
          throw new BadRequestException('Invalid `to` date');
        }
        if (from.getTime() > to.getTime()) {
          throw new BadRequestException(
            '`from` must be earlier than or equal to `to`',
          );
        }
      }
    } else if (query.to) {
      const to = new Date(query.to);
      if (Number.isNaN(to.getTime())) {
        throw new BadRequestException('Invalid `to` date');
      }
    }
  }

  private formatRow(row: FinancialRow): string {
    const cells: ReadonlyArray<unknown> = [
      row.id,
      row.booking.id,
      row.updatedAt.toISOString(),
      decimalToString(row.amount),
      row.currency,
      decimalToString(row.refundedAmount),
      decimalToString(row.booking.commissionAmount),
      row.booking.vendor.id,
      row.booking.vendor.businessName,
      row.booking.vendor.user.email,
      row.booking.customer.id,
      row.booking.customer.name,
      row.booking.customer.email,
    ];
    return cells.map(escapeCell).join(',');
  }
}

/** RFC 4180 quoting + spreadsheet-formula escape. See class doc. */
export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const str = typeof value === 'string' ? value : String(value);
  const safe = FORMULA_LEADING.has(str.charAt(0)) ? "'" + str : str;
  return '"' + safe.replace(/"/g, '""') + '"';
}

/** Render a Prisma.Decimal (or any `toString()`-bearing object) stably. */
function decimalToString(d: { toString(): string }): string {
  return d.toString();
}