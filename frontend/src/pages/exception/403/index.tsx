import { Link } from '@umijs/max';
import { Button, Card, Result } from 'antd';

/** Shown for routes the user's role can't open, for example `/settings/system` for operators. */
export default () => (
  <Card variant="borderless">
    <Result
      status="403"
      title="403"
      subTitle="You don't have permission to see this page."
      extra={
        <Link to="/overview" prefetch>
          <Button type="primary">Go to Overview</Button>
        </Link>
      }
    />
  </Card>
);
