// corp-industry-job.model.ts
// Stores corporation industry jobs fetched from ESI.
//
// ESI endpoint: GET /corporations/{corporation_id}/industry/jobs/?include_completed=true
// Scope: esi-industry.read_corporation_jobs.v1
//
// Industry jobs track manufacturing, invention, research, and copying activities.
// The `cost` field is the ISK installation fee charged when the job was started.

import mongoose, { Schema, Document } from 'mongoose';

export interface ICorpIndustryJob extends Document {
  jobId:             number;            // ESI: job_id — unique per job
  corporationId:     number;            // the corporation that owns this job
  installerId:       number;            // character who started the job
  activityId:        number;            // 1=manufacturing, 3=TE, 4=ME, 5=copying, 8=invention
  blueprintTypeId:   number;            // blueprint used
  productTypeId:     number | null;     // output item (null for research)
  cost:              number;            // ISK installation cost
  startDate:         Date;
  endDate:           Date;
  status:            string;            // active, delivered, cancelled, paused, ready
  runs:              number;
  licensedRuns:      number;
  facilityId:        number;            // structure/station where job runs
  outputLocationId:  number;            // where output is delivered
}

const CorpIndustryJobSchema = new Schema<ICorpIndustryJob>(
  {
    jobId:             { type: Number, required: true },
    corporationId:     { type: Number, required: true },
    installerId:       { type: Number, required: true },
    activityId:        { type: Number, required: true },
    blueprintTypeId:   { type: Number, required: true },
    productTypeId:     { type: Number, default: null },
    cost:              { type: Number, required: true },
    startDate:         { type: Date, required: true },
    endDate:           { type: Date, required: true },
    status:            { type: String, required: true },
    runs:              { type: Number, required: true },
    licensedRuns:      { type: Number, default: 0 },
    facilityId:        { type: Number, required: true },
    outputLocationId:  { type: Number, required: true },
  },
  { timestamps: true }
);

// One job per jobId (globally unique in ESI)
CorpIndustryJobSchema.index({ jobId: 1 }, { unique: true });
// For querying completed jobs by corporation and date range
CorpIndustryJobSchema.index({ corporationId: 1, endDate: -1 });

export const CorpIndustryJob = mongoose.model<ICorpIndustryJob>(
  'CorpIndustryJob',
  CorpIndustryJobSchema,
  'corp_industry_jobs'
);
