import { PageContainer } from '@ant-design/pro-components';
import { Empty } from 'antd';
import React from 'react';
import AccountGate from '@/components/AccountGate';

export type PlaceholderPageProps = {
  /** The page title, as in the sidebar. */
  title: string;
  /** The story that builds the page, for example `E01-S01`. */
  story: string;
  /** Account-scoped pages show the "No account selected" state first (rule 22). */
  accountScoped?: boolean;
};

/**
 * A route whose page arrives with a later story (E00-S02 rules 10 and 30). That story replaces
 * the route's page file; layout, theme and error handling stay as they are.
 */
const PlaceholderPage: React.FC<PlaceholderPageProps> = ({
  title,
  story,
  accountScoped = true,
}) => {
  const body = (
    <PageContainer title={title}>
      <Empty description={`This page arrives with ${story}.`} />
    </PageContainer>
  );
  return accountScoped ? <AccountGate title={title}>{body}</AccountGate> : body;
};

export default PlaceholderPage;
