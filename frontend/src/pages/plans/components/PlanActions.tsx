import { history } from '@umijs/max';
import { Button, message, Modal, notification, Space, Tooltip } from 'antd';
import dayjs from 'dayjs';
import React, { useState } from 'react';
import type { Account } from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import {
  activatePlan,
  closePlan,
  deletePlan,
  type Plan,
  type ReadinessProblem,
} from '@/services/socialhub/plans';
import { notifyError } from '@/utils/errorText';
import { problemText, weekEnded } from '../shared';
import PlanWeekModal from './PlanWeekModal';

export type PlanActionsProps = {
  plan: Plan;
  account: Account;
  /** Unsaved form changes and a way to save them first. */
  dirty: boolean;
  saveFirst: () => Promise<boolean>;
  onChanged: (plan?: Plan) => void;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Header actions per status (E01-S03 panel table). */
const PlanActions: React.FC<PlanActionsProps> = ({
  plan,
  account,
  dirty,
  saveFirst,
  onChanged,
}) => {
  const [busy, setBusy] = useState<null | 'activate' | 'close' | 'delete'>(null);
  const [copying, setCopying] = useState(false);
  const { readiness } = plan;

  const activate = async () => {
    if (dirty) {
      const proceed = await new Promise<boolean>((resolve) =>
        Modal.confirm({
          title: 'Save your changes first?',
          content: 'The plan is activated as it is saved.',
          okText: 'Save and continue',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        }),
      );
      if (!proceed || !(await saveFirst())) return;
    }
    Modal.confirm({
      title: 'Activate this plan?',
      content:
        'Research and selection can start once the plan is active. You can still edit goals and slots.',
      okText: 'Activate',
      onOk: async () => {
        setBusy('activate');
        try {
          const updated = await activatePlan(plan.id);
          message.success('Plan activated');
          notification.success({
            title: 'Plan activated',
            description: 'Research the week’s trends next.',
            actions: (
              <Button
                type="primary"
                size="small"
                onClick={() => {
                  notification.destroy();
                  history.push(`/research?plan=${plan.id}`);
                }}
              >
                Run research
              </Button>
            ),
          });
          onChanged(updated);
        } catch (error) {
          if (isApiError(error) && error.details?.problems) {
            message.warning('The plan is not ready yet.');
          } else {
            notifyError(error);
          }
          onChanged();
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const close = () => {
    const ended = weekEnded(plan.week_end, account.timezone);
    const open = plan.slot_summary.by_status.open ?? 0;
    Modal.confirm({
      title: 'Close this plan?',
      content: (
        <>
          <p>Open slots will be marked as skipped and the weekly report will be prepared.</p>
          {!ended && (
            <p>
              This week ends on {dayjs(plan.week_end).format('D MMM')}. Closing now skips{' '}
              {plural(open, 'open slot', 'open slots')}; items already in production keep going.
            </p>
          )}
        </>
      ),
      okText: ended ? 'Close plan' : 'Close early',
      okButtonProps: { danger: !ended },
      onOk: async () => {
        setBusy('close');
        try {
          const result = await closePlan(plan.id, !ended);
          message.success(
            `Plan closed. ${plural(result.slots_skipped, 'slot', 'slots')} skipped, ${plural(
              result.unfinished_items,
              'item',
              'items',
            )} still in progress.`,
          );
          onChanged(result.plan);
        } catch (error) {
          notifyError(error);
          onChanged();
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const remove = () =>
    Modal.confirm({
      title: `Delete the draft plan “${plan.title}” and its slots?`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy('delete');
        try {
          await deletePlan(plan.id);
          message.success('Draft plan deleted');
          history.push('/plans');
        } catch (error) {
          notifyError(error);
          onChanged();
        } finally {
          setBusy(null);
        }
      },
    });

  const notReady = readiness.problems.map((problem: ReadinessProblem) => problemText(problem));

  return (
    <Space wrap>
      {plan.status === 'draft' && (
        <Tooltip
          title={
            readiness.can_activate ? undefined : (
              <>
                Before activating:
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {notReady.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )
          }
        >
          <Button
            type="primary"
            disabled={!readiness.can_activate || busy !== null}
            loading={busy === 'activate'}
            onClick={activate}
          >
            Activate plan
          </Button>
        </Tooltip>
      )}
      {plan.status === 'active' && (
        <Button loading={busy === 'close'} disabled={busy !== null} onClick={close}>
          Close plan
        </Button>
      )}
      <Button disabled={busy !== null} onClick={() => setCopying(true)}>
        Duplicate
      </Button>
      {plan.status === 'draft' && (
        <Button danger loading={busy === 'delete'} disabled={busy !== null} onClick={remove}>
          Delete
        </Button>
      )}
      <PlanWeekModal
        account={account}
        open={copying}
        source={plan}
        onOpenChange={setCopying}
      />
    </Space>
  );
};

export default PlanActions;
