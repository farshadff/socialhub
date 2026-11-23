import { useQuery } from '@tanstack/react-query';
import { Link } from '@umijs/max';
import { message, notification, theme } from 'antd';
import React from 'react';
import JobButton from '@/components/JobButton';
import { useActiveJob } from '@/hooks/useJob';
import { type BriefBatchResult, generatePlanBriefs } from '@/services/socialhub/briefs';
import { getPlanForContent } from '@/services/socialhub/content';
import { isApiError } from '@/services/socialhub/http';
import type { Job } from '@/services/socialhub/jobs';
import { useAccountId } from '@/utils/accountRequest';
import { jobErrorText } from '@/utils/errorText';

export type WriteMissingBriefsButtonProps = {
  /** The plan chosen in the /content filter; null for "All plans". */
  planId: number | null;
  onDone: () => void;
};

const KIND = 'brief.generate_batch';

/**
 * "Write missing briefs" (E04-S03): one job that writes briefs for every waiting item of an
 * active plan. Shown only when the plan filter is one active plan.
 */
const WriteMissingBriefsButton: React.FC<WriteMissingBriefsButtonProps> = ({ planId, onDone }) => {
  const accountId = useAccountId();
  const { token } = theme.useToken();
  const planQuery = useQuery({
    queryKey: [accountId, 'plan', planId],
    enabled: planId !== null,
    queryFn: () => getPlanForContent(planId as number),
  });
  const activeQuery = useActiveJob({
    account: accountId,
    kinds: [KIND],
    targetType: 'plan',
    targetId: planId === null ? undefined : String(planId),
  });

  if (planId === null || planQuery.data?.status !== 'active') return null;

  const result = (job: Job) => (job.result ?? {}) as Partial<BriefBatchResult>;

  const onFinished = (job: Job) => {
    const outcome = result(job);
    const failedItems = (outcome.items ?? []).filter((entry) => entry.status === 'failed');
    if (failedItems.length > 0) {
      notification.warning({
        title: `${failedItems.length} ${failedItems.length === 1 ? 'brief' : 'briefs'} could not be written`,
        description: (
          <ul style={{ margin: 0, paddingInlineStart: token.paddingMD }}>
            {failedItems.map((entry) => (
              <li key={entry.content_item}>
                <Link to={`/content/${entry.content_item}?tab=brief`}>
                  Item {entry.content_item}
                </Link>
                {entry.error_code ? ` — ${jobErrorText({ error_code: entry.error_code })}` : null}
              </li>
            ))}
          </ul>
        ),
      });
    }
    onDone();
  };

  return (
    <JobButton
      key={planId}
      kinds={[KIND]}
      activeJob={activeQuery.data ?? null}
      start={() => generatePlanBriefs(planId)}
      successMessage={(job) => {
        const created = result(job).created ?? 0;
        return `${created} ${created === 1 ? 'brief' : 'briefs'} written`;
      }}
      onStarted={() => onDone()}
      onDone={onFinished}
      onFailed={() => onDone()}
      onStartError={(error) => {
        if (
          isApiError(error) &&
          error.code === 'validation_error' &&
          // The spec names the code `nothing_to_do` with `details.skipped`; accept it as a field
          // code or recognise it by `details.skipped`.
          (error.fields.some((field) => field.code === 'nothing_to_do') ||
            Array.isArray(error.details.skipped))
        ) {
          message.info('Every selected item already has a brief or one is being written.');
          return true;
        }
        return false;
      }}
      runningReason="Briefs are being written for this plan"
    >
      Write missing briefs
    </JobButton>
  );
};

export default WriteMissingBriefsButton;
