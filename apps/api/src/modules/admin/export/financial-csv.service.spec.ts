/**
 * Phase B5 — Financial CSV export service tests.
 *
 * Pure unit tests against a mocked PrismaService. No DB access:
 * cursor pagination is easier to exercise deterministically here
 * than against a real DB. Coverage:
 *   - Headers: deterministic, no BOM, CRLF terminators.
 *   - Escaping: commas, quotes, newlines, CR, formula-leading chars.
 *   - Filters: ISO `from`/`to` forward to Prisma as an updatedAt range.
 *   - Batching: cursor pagination honours batchSize, cursor+skip:1.
 *   - Sensitive fields: the SELECT projection never asks for passwords,
 *     tokens, phones, addresses, lat/lng, or external provider IDs.
 *   - DTO validation: malformed ISO and out-of-range batchSize.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import {
  FinancialCsvExportService,
  FINANCIAL_CSV_HEADERS,
  escapeCell,
} from './financial-csv.service';
import {
  FINANCIAL_EXPORT_DEFAULT_BATCH_SIZE,
  FINANCIAL_EXPORT_MAX_BATCH_SIZE,
  FinancialExportQueryDto,
} from '../dto/financial-export-query.dto';
import { PrismaService } from '../../../shared/modules/prisma/prisma.service';

/* ───────────── helpers ───────────── */

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const chunk of gen) out += chunk;
  return out;
}

const D = (s: string) => new Prisma.Decimal(s);

function makePayment(over: Record<string, unknown> = {}) {
  const o = over as {
    id?: string;
    booking?: { vendor?: { businessName?: string }; customer?: { name?: string } };
  };
  return {
    id: o.id ?? 'pay_1',
    updatedAt: new Date('2024-06-15T12:00:00Z'),
    amount: D('100.00'),
    currency: 'brl',
    refundedAmount: D('0.00'),
    booking: {
      id: 'bk_1',
      commissionAmount: D('10.00'),
      customer: {
        id: 'usr_cust_1',
        name: o.booking?.customer?.name ?? 'Sara',
        email: 'sara@x.test',
      },
      vendor: {
        id: 'vnd_1',
        businessName: o.booking?.vendor?.businessName ?? 'Acme',
        user: { email: 'owner@x.test' },
      },
    },
  };
}

function flattenSelect(node: unknown, prefix = ''): string[] {
  if (node === true || node === false) return prefix ? [prefix] : [];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([k, v]) =>
    flattenSelect(v, prefix ? `${prefix}.${k}` : k),
  );
}

/* ───────────── tests ───────────── */

describe('FinancialCsvExportService', () => {
  let service: FinancialCsvExportService;
  let findMany: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn();
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialCsvExportService,
        { provide: PrismaService, useValue: { payment: { findMany } } },
      ],
    }).compile();
    service = mod.get(FinancialCsvExportService);
  });

  /* HEADER ROW */
  describe('header row', () => {
    it('emits the deterministic column order first, with CRLF terminators and no BOM', async () => {
      findMany.mockResolvedValueOnce([]);
      const csv = await collect(service.streamFinancialCsv({}));
      expect(csv.split('\r\n')[0]).toBe(FinancialCsvExportService.HEADER_ROW);
      expect(FINANCIAL_CSV_HEADERS).toEqual([
        'payment_id', 'booking_id', 'paid_at', 'amount', 'currency',
        'refunded_amount', 'commission_amount', 'vendor_id', 'vendor_name',
        'vendor_email', 'customer_id', 'customer_name', 'customer_email',
      ]);
      expect(csv.endsWith('\r\n')).toBe(true);
      expect(csv.charCodeAt(0)).not.toBe(0xfeff);
      expect(FinancialCsvExportService.USE_BOM).toBe(false);
    });
  });

  /* ESCAPING */
  describe('escapeCell (RFC 4180 + formula safety)', () => {
    it('quotes plain values and doubles embedded quotes', () => {
      expect(escapeCell('hello')).toBe('"hello"');
      expect(escapeCell('he said "hi"')).toBe('"he said ""hi"""');
    });

    it('preserves commas and newlines inside quotes', () => {
      expect(escapeCell('a, b')).toBe('"a, b"');
      expect(escapeCell('line1\nline2')).toBe('"line1\nline2"');
      expect(escapeCell('a\r\nb')).toBe('"a\r\nb"');
    });

    it('renders null and undefined as empty quoted cell ""', () => {
      expect(escapeCell(null)).toBe('""');
      expect(escapeCell(undefined)).toBe('""');
    });

    it('prefixes formula-leading characters with an apostrophe, but only at position 0', () => {
      /* Each of these would be executed as a formula by Excel/Sheets
       * if exported without the apostrophe prefix. */
      expect(escapeCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');
      expect(escapeCell('+1')).toBe('"\'+1"');
      expect(escapeCell('-1')).toBe('"\'-1"');
      expect(escapeCell('@evil')).toBe('"\'@evil"');
      expect(escapeCell('\tsneaky')).toBe('"\'\tsneaky"');
      expect(escapeCell('\rsneaky')).toBe('"\'\rsneaky"');
      /* Triggers at non-zero positions stay as text. */
      expect(escapeCell('a=b')).toBe('"a=b"');
      expect(escapeCell('foo + bar')).toBe('"foo + bar"');
    });

    it('survives hostile vendor/customer names in emitted rows', async () => {
      findMany.mockResolvedValueOnce([
        makePayment({
          booking: {
            vendor: { businessName: 'Evil"Co\n=DROP TABLE' },
            customer: { name: '=cmd|"calc"!A1' },
          },
        }),
      ]);
      const csv = await collect(service.streamFinancialCsv({}));
      const data = csv.split('\r\n')[1]!;
      expect(data).toContain('"Evil""Co\n=DROP TABLE"');
      expect(data).toContain('"\'=cmd|""calc""!A1"');
    });
  });

  /* FILTERS */
  describe('date filter forwarding', () => {
    it('forwards from + to, from-only, and no-dates as the right updatedAt key', async () => {
      findMany.mockResolvedValue([]);
      const from = '2024-01-01T00:00:00Z';
      const to = '2024-12-31T23:59:59Z';
      await collect(service.streamFinancialCsv({ from, to }));
      await collect(service.streamFinancialCsv({ from }));
      await collect(service.streamFinancialCsv({}));
      const [a, b, c] = findMany.mock.calls.map((c) => c[0]!.where);
      expect(a.updatedAt).toEqual({ gte: new Date(from), lte: new Date(to) });
      expect(b.updatedAt).toEqual({ gte: new Date(from) });
      expect(c).toEqual({ status: PaymentStatus.SUCCEEDED });
    });

    it('rejects reversed ranges with BadRequestException, no DB call', async () => {
      await expect(
        collect(service.streamFinancialCsv({
          from: '2024-12-01T00:00:00Z', to: '2024-01-01T00:00:00Z',
        })),
      ).rejects.toThrow(BadRequestException);
      expect(findMany).not.toHaveBeenCalled();
      expect(() =>
        service.validateQuery({ from: '2024-12-01', to: '2024-01-01' }),
      ).toThrow(BadRequestException);
    });
  });

  /* BATCHING */
  describe('cursor pagination', () => {
    it('emits a single batch when results fit in batchSize', async () => {
      findMany.mockResolvedValueOnce([
        makePayment({ id: 'a' }),
        makePayment({ id: 'b' }),
      ]);
      const csv = await collect(service.streamFinancialCsv({ batchSize: 500 }));
      expect(csv.split('\r\n').filter(Boolean).length).toBe(1 + 2);
      expect(findMany).toHaveBeenCalledTimes(1);
    });

    it('paginates with cursor + skip:1 when a batch overflows', async () => {
      /* First page: 501 rows ⇒ hasMore=true, emit 500, cursor='p499'. */
      const full = Array.from({ length: 501 }, (_, i) => makePayment({ id: `p${i}` }));
      findMany.mockResolvedValueOnce(full).mockResolvedValueOnce([makePayment({ id: 'tail' })]);

      const csv = await collect(service.streamFinancialCsv({ batchSize: 500 }));
      expect(csv.split('\r\n').filter(Boolean).length).toBe(1 + 500 + 1);
      expect(findMany.mock.calls[1]![0]).toMatchObject({
        cursor: { id: 'p499' },
        skip: 1,
        take: FINANCIAL_EXPORT_DEFAULT_BATCH_SIZE + 1,
      });
    });

    it('clamps a too-large batchSize and defaults when omitted', async () => {
      findMany.mockResolvedValue([]);
      await collect(
        service.streamFinancialCsv({ batchSize: 10000 } as FinancialExportQueryDto),
      );
      await collect(service.streamFinancialCsv({}));
      const takes = findMany.mock.calls.map((c) => c[0]!.take);
      expect(takes).toEqual([
        FINANCIAL_EXPORT_MAX_BATCH_SIZE + 1,
        FINANCIAL_EXPORT_DEFAULT_BATCH_SIZE + 1,
      ]);
    });
  });

  /* SELECT PROJECTION — sensitive-field audit */
  describe('SELECT projection excludes sensitive fields', () => {
    it('never asks for passwords, tokens, phones, addresses, or external IDs', async () => {
      findMany.mockResolvedValueOnce([]);
      await collect(service.streamFinancialCsv({}));
      const sel = findMany.mock.calls[0]![0].select;
      const fields = flattenSelect(sel);
      const forbidden = [
        'clientSecret', 'lastEventId', 'externalId',
        'cancellationReason', 'cancelledBy', 'holdExpiresAt',
        'passwordHash', 'phone', 'googleId', 'isLocked',
        'address', 'lat', 'lng', 'description', 'commissionRate',
        'refreshTokens', 'passwordResets',
      ];
      for (const f of forbidden) expect(fields).not.toContain(f);
      /* Customer and vendor.user are the two user-relation selects.
       * Both must be minimal: no phone, no passwordHash, etc. */
      expect(Object.keys(sel.booking.select.customer.select).sort()).toEqual(['email', 'id', 'name']);
      expect(Object.keys(sel.booking.select.vendor.select.user.select).sort()).toEqual(['email']);
    });
  });

  /* DTO */
  describe('FinancialExportQueryDto', () => {
    it('accepts valid ISO and stringified batchSize', async () => {
      const dto = plainToInstance(FinancialExportQueryDto, {
        from: '2024-01-01', to: '2024-12-31T23:59:59Z', batchSize: '100',
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rejects malformed ISO, oversize batchSize, and non-int batchSize', async () => {
      for (const input of [{ from: 'not-a-date' }, { batchSize: 1000 }, { batchSize: 'abc' }]) {
        const errors = await validate(plainToInstance(FinancialExportQueryDto, input));
        expect(errors.length).toBeGreaterThan(0);
      }
    });
  });

  /* FILENAME */
  describe('buildFilename', () => {
    it('produces a deterministic ISO-derived attachment name', () => {
      expect(service.buildFilename(new Date('2024-06-15T12:34:56.789Z')))
        .toBe('servicehub-financial-2024-06-15-12-34-56.csv');
      expect(service.buildFilename()).toMatch(
        /^servicehub-financial-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/,
      );
    });
  });
});