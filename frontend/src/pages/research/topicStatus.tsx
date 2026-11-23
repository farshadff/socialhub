import { Button, message } from 'antd';
import React from 'react';
import { isApiError } from '@/services/socialhub/http';
import { type TrendTopic, updateTopic } from '@/services/socialhub/research';
import { notifyError } from '@/utils/errorText';
import { type TopicAction, undoSteps } from './constants';

/**
 * Applies a status action at once and offers "Undo" for 5 seconds (E02-S05 rule 13).
 * Returns true when the change was saved.
 */
export async function changeTopicStatus(
  topic: Pick<TrendTopic, 'id' | 'status'>,
  action: TopicAction,
  onChanged: () => void,
): Promise<boolean> {
  try {
    await updateTopic(topic.id, { status: action.to });
  } catch (error) {
    if (isApiError(error) && error.code === 'invalid_transition') {
      message.warning('This topic changed. Reloading.');
      onChanged();
    } else {
      notifyError(error);
    }
    return false;
  }
  onChanged();
  const key = `topic-status-${topic.id}`;
  const undo = async () => {
    message.destroy(key);
    try {
      for (const step of undoSteps(topic.status, action.to)) {
        await updateTopic(topic.id, { status: step });
      }
    } catch (error) {
      if (isApiError(error) && error.code === 'invalid_transition') {
        message.warning('This topic changed. Reloading.');
      } else {
        notifyError(error);
      }
    }
    onChanged();
  };
  message.success({
    key,
    duration: 5,
    content: (
      <span>
        {action.message}{' '}
        <Button
          type="link"
          size="small"
          onClick={undo}
          style={{ padding: 0, height: 'auto' }}
        >
          Undo
        </Button>
      </span>
    ),
  });
  return true;
}
