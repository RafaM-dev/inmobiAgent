import type {
  Lead as PrismaLead,
  LeadPropertyInterest as PrismaInterest,
} from "../../../../../generated/prisma/client";
import { toJson } from "../../../../../platform/database/json";
import type { Database } from "../../../../../platform/database/prisma";
import { assertWritableTenant, tenantScope } from "../../../../../platform/database/tenant-scope";
import type { IdGenerator } from "../../../../../platform/ids/id-generator";
import { Lead, type LeadStatus } from "../../../domain/entities/lead";
import type {
  LeadListFilter,
  LeadRepository,
  LeadSummary,
} from "../../../domain/repositories/lead.repository";
import type { LeadInterest } from "../../../domain/value-objects/lead-interest";
import type { LeadRequirements } from "../../../domain/value-objects/lead-requirements";
import type { ScoreReason } from "../../../domain/value-objects/lead-score";

/** Estados en los que el lead sigue vivo comercialmente. */
const OPEN_STATUSES: readonly LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "SCHEDULED"];

type LeadRow = PrismaLead & { interests?: PrismaInterest[] };

const toDomain = (row: LeadRow): Lead =>
  Lead.rehydrate({
    id: row.id,
    tenantId: row.tenantId,
    contactId: row.contactId,
    conversationId: row.conversationId,
    source: row.source,
    status: row.status,
    requirements: (row.requirements ?? {}) as LeadRequirements,
    interests: (row.interests ?? []).map(
      (interest): LeadInterest => ({
        propertyRef: interest.propertyRef,
        firstShownAt: interest.firstShownAt,
        lastShownAt: interest.lastShownAt,
        timesShown: interest.timesShown,
      }),
    ),
    score: {
      value: row.score,
      band: row.band,
      reasons: (row.scoreReasons ?? []) as unknown as ScoreReason[],
    },
    ...(row.assignedUserId !== null ? { assignedUserId: row.assignedUserId } : {}),
    consent: {
      dataProcessing: row.consentDataProcessing,
      marketing: row.consentMarketing,
      ...(row.consentGrantedAt !== null ? { grantedAt: row.consentGrantedAt } : {}),
    },
    visitRequested: row.visitRequested,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivityAt: row.lastActivityAt,
  });

export class PrismaLeadRepository implements LeadRepository {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  async findById(id: string): Promise<Lead | null> {
    const row = await this.db.client().lead.findFirst({
      where: { ...tenantScope(), id },
      include: { interests: true },
    });
    return row ? toDomain(row) : null;
  }

  async findByConversation(conversationId: string): Promise<Lead | null> {
    const row = await this.db.client().lead.findUnique({
      where: { tenantId_conversationId: { ...tenantScope(), conversationId } },
      include: { interests: true },
    });
    return row ? toDomain(row) : null;
  }

  /**
   * Agregado, intereses e historial en la misma llamada. Si el caso de uso la
   * envuelve en `unitOfWork.run()` —y todos lo hacen— caen en la misma
   * transacción que los eventos del outbox: no puede quedar un `lead.qualified`
   * publicado sobre una puntuación que no se guardó.
   */
  async save(lead: Lead): Promise<void> {
    const data = lead.snapshot();
    assertWritableTenant(data.tenantId, "lead");

    const client = this.db.client();

    const persistable = {
      status: data.status,
      requirements: toJson(data.requirements),
      score: data.score.value,
      band: data.score.band,
      scoreReasons: toJson(data.score.reasons),
      assignedUserId: data.assignedUserId ?? null,
      consentDataProcessing: data.consent.dataProcessing,
      consentMarketing: data.consent.marketing,
      consentGrantedAt: data.consent.grantedAt ?? null,
      visitRequested: data.visitRequested,
      updatedAt: data.updatedAt,
      lastActivityAt: data.lastActivityAt,
    };

    await client.lead.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        tenantId: data.tenantId,
        contactId: data.contactId,
        conversationId: data.conversationId,
        source: data.source,
        createdAt: data.createdAt,
        ...persistable,
      },
      update: persistable,
    });

    for (const interest of data.interests) {
      await client.leadPropertyInterest.upsert({
        where: {
          leadId_propertyRef: { leadId: data.id, propertyRef: interest.propertyRef },
        },
        create: {
          id: this.ids.generate(),
          tenantId: data.tenantId,
          leadId: data.id,
          propertyRef: interest.propertyRef,
          firstShownAt: interest.firstShownAt,
          lastShownAt: interest.lastShownAt,
          timesShown: interest.timesShown,
        },
        update: {
          lastShownAt: interest.lastShownAt,
          timesShown: interest.timesShown,
        },
      });
    }

    const history = lead.pullHistory();
    if (history.length > 0) {
      await client.leadEvent.createMany({
        data: history.map((entry) => ({
          id: this.ids.generate(),
          tenantId: data.tenantId,
          leadId: data.id,
          type: entry.type,
          payload: toJson(entry.payload),
          occurredAt: entry.at,
        })),
      });
    }
  }

  async list(filter: LeadListFilter): Promise<readonly LeadSummary[]> {
    const rows = await this.db.client().lead.findMany({
      where: {
        ...tenantScope(),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.band ? { band: filter.band } : {}),
        ...(filter.assignedUserId ? { assignedUserId: filter.assignedUserId } : {}),
      },
      orderBy: [{ score: "desc" }, { lastActivityAt: "desc" }],
      take: filter.limit,
      skip: filter.offset ?? 0,
      include: { _count: { select: { interests: true } } },
    });

    return rows.map(
      (row): LeadSummary => ({
        id: row.id,
        contactId: row.contactId,
        conversationId: row.conversationId,
        status: row.status,
        score: row.score,
        band: row.band,
        ...(row.assignedUserId !== null ? { assignedUserId: row.assignedUserId } : {}),
        interestCount: row._count.interests,
        lastActivityAt: row.lastActivityAt,
      }),
    );
  }

  async countOpenByAssignee(): Promise<Readonly<Record<string, number>>> {
    const rows = await this.db.client().lead.groupBy({
      by: ["assignedUserId"],
      where: {
        ...tenantScope(),
        status: { in: [...OPEN_STATUSES] },
        assignedUserId: { not: null },
      },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (row.assignedUserId !== null) counts[row.assignedUserId] = row._count._all;
    }
    return counts;
  }
}
