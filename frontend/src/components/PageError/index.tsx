import { Button, Result, Typography } from 'antd';
import React from 'react';
import { isApiError } from '@/services/socialhub/http';
import { errorText } from '@/utils/errorText';

export type PageErrorProps = {
  error: unknown;
  onRetry?: () => void;
  title?: React.ReactNode;
};

/** Inline error state: the text for the code, Retry, and the request reference (E00-S02 rule 29). */
const PageError: React.FC<PageErrorProps> = ({ error, onRetry, title }) => {
  const reference = isApiError(error) ? error.request_id : null;
  return (
    <Result
      status="error"
      title={title ?? errorText(error)}
      subTitle={
        reference ? (
          <Typography.Text type="secondary">
            Reference: {reference}
          </Typography.Text>
        ) : undefined
      }
      extra={
        onRetry ? (
          <Button type="primary" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    />
  );
};

export default PageError;
