import type { LevelRow } from "@/lib/pathshala-registration/contract";
import { ADULT_AGE, AGE_LIMITS } from "@/lib/pathshala-registration/contract";
import { AUDIENCE_HINT, AUDIENCE_LABEL, ageBandLabel, levelAudience } from "@/lib/pathshala-registration/levels";

import { FormGrid, PField } from "../ui";

/**
 * The fields of the level drawer (add or edit), named as saveLevelAction reads them. The age band is whole years on
 * the term's age cut-off date (plan §2.1): a minimum of 18 or more makes an adult class, a maximum under 18 a
 * children's level; app.save_pathshala_level decides what is valid.
 */
export function LevelFields({ level, track, nextOrder }: { level: LevelRow | null; track: { id: string; name: string }; nextOrder: number }) {
  const audience = level ? levelAudience(level.min_age, level.max_age) : null;
  return (
    <>
      <input type="hidden" name="track_id" value={track.id} />
      <input type="hidden" name="track_name" value={track.name} />
      <input type="hidden" name="active" value={level && !level.active ? "false" : "true"} />
      <PField label="Name" hint={`What families see, for example ${track.name} 3 or Adult class (Moms).`}>
        <input name="name" required maxLength={80} defaultValue={level?.name ?? ""} className="crm-input" />
      </PField>
      <FormGrid cols={2}>
        <PField
          label="Key"
          hint={level ? "Short and unique in the track; imports and reports use it." : `Leave blank to make one from the name (“${track.name} 8” becomes 8).`}
        >
          <input name="key" maxLength={40} defaultValue={level?.key ?? ""} required={Boolean(level)} className="crm-input font-mono" />
        </PField>
        <PField label="Order" hint="Lower numbers come first.">
          <input name="sort_order" inputMode="numeric" defaultValue={level?.sort_order ?? nextOrder} className="crm-input" />
        </PField>
        <PField label="Minimum age" hint={`Blank for none. ${ADULT_AGE} or more makes an adult class.`}>
          <input name="min_age" inputMode="numeric" defaultValue={level?.min_age ?? ""} className="crm-input" />
        </PField>
        <PField label="Maximum age" hint={`Blank for none. Under ${ADULT_AGE} makes a children's level.`}>
          <input name="max_age" inputMode="numeric" defaultValue={level?.max_age ?? ""} className="crm-input" />
        </PField>
      </FormGrid>
      <p className="crm-hint">
        Ages are whole years ({AGE_LIMITS.min} to {AGE_LIMITS.max}) on the term&apos;s age cut-off date, the first day of term unless the term sets
        another. The band suggests levels to families in the app, keeps adult classes for adults and children&apos;s levels for children. Leave both
        blank for a level open to anyone.
        {level && audience ? ` Now: ${AUDIENCE_LABEL[audience]} · ${ageBandLabel(level.min_age, level.max_age)}. ${AUDIENCE_HINT[audience]}` : ""}
      </p>
      <PField label="Reason (optional)" hint="Kept in the level's history.">
        <input name="reason" maxLength={200} className="crm-input" />
      </PField>
    </>
  );
}
