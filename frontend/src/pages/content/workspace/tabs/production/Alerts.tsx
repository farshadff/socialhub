import { Alert, Button, Flex, Typography, theme } from 'antd';
import React, { useState } from 'react';
import DateTime from '@/components/DateTime';
import type { TabKey } from '../../types';
import {
  failedStep,
  framesNeedingImage,
  joinNumbers,
  startJob,
  stoppedText,
  useProductionContext,
} from './shared';

export type AlertsProps = {
  onBackToCurrent: () => void;
  switchTab: (tab: TabKey) => void;
};

/** The alerts under the tab header (E06-S07 "Alerts" and the read-only states). */
const Alerts: React.FC<AlertsProps> = ({ onBackToCurrent, switchTab }) => {
  const { token } = theme.useToken();
  const {
    item,
    production,
    onJobStarted,
    handleError,
    jobRunning,
    isCurrentDraft,
  } = useProductionContext();
  const [resuming, setResuming] = useState(false);
  const alerts: React.ReactNode[] = [];

  const resume = async () => {
    setResuming(true);
    try {
      const { job } = await startJob(item.id, false)();
      onJobStarted(job);
    } catch (error) {
      handleError(error);
    } finally {
      setResuming(false);
    }
  };

  if (!production.is_current) {
    alerts.push(
      <Alert
        key="older"
        type="info"
        showIcon
        title={`You are viewing version ${production.version}. It is read-only.`}
        action={
          <Typography.Link onClick={onBackToCurrent}>
            Back to the current version
          </Typography.Link>
        }
      />,
    );
  }

  if (production.is_current && item.status === 'needs_revision') {
    alerts.push(
      <Alert
        key="revision"
        type="info"
        showIcon
        title="An automatic revision is being prepared. Editing is available again when it reaches production."
      />,
    );
  }

  if (
    production.is_current &&
    production.status &&
    production.status !== 'draft'
  ) {
    alerts.push(
      <Alert
        key="submitted"
        type="info"
        showIcon
        title={
          production.submitted_at ? (
            <span>
              This version was submitted on{' '}
              <DateTime value={production.submitted_at} />. Changes go into a
              new version.
            </span>
          ) : (
            'This version was submitted. Changes go into a new version.'
          )
        }
      />,
    );
  }

  if (production.script && !production.script.is_current) {
    const newer = item.current_script?.version;
    alerts.push(
      <Alert
        key="newer-script"
        type="warning"
        showIcon
        title={`A newer script${newer ? ` (version ${newer})` : ''} exists. Approve it to produce a new version, or submit this one as it is after the script is approved.`}
        action={
          <Typography.Link onClick={() => switchTab('script')}>
            Open the script
          </Typography.Link>
        }
      />,
    );
  }

  if (isCurrentDraft && production.origin === 'pipeline') {
    const needing = framesNeedingImage(production);
    if (needing.length > 0) {
      alerts.push(
        <Alert
          key="backgrounds"
          type="warning"
          showIcon
          title={
            needing.length === 1
              ? `Frame ${needing[0]} needs an image. Open the frame and choose or generate one, then re-render.`
              : `Frames ${joinNumbers(needing)} need an image. Open each frame and choose or generate one, then re-render.`
          }
        />,
      );
    }
    const failed = failedStep(production);
    if (failed && !jobRunning) {
      alerts.push(
        <Alert
          key="failed"
          type="error"
          showIcon
          title={stoppedText(failed.step, failed.errorCode)}
          action={
            production.actions.can_start ? (
              <Button size="small" onClick={resume} loading={resuming}>
                Try again
              </Button>
            ) : undefined
          }
        />,
      );
    }
  }

  if (production.origin === 'manual_upload') {
    alerts.push(
      <Alert
        key="manual"
        type="info"
        showIcon
        title="This version uses your uploaded file. Frames are not used. Start production again to go back to rendered output."
      />,
    );
  }

  if (alerts.length === 0) return null;
  return (
    <Flex vertical gap={token.marginXS}>
      {alerts}
    </Flex>
  );
};

export default Alerts;
