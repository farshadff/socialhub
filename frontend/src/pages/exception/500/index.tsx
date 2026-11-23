import { Link } from '@umijs/max';
import { Button, Card, Result } from 'antd';

export default () => (
  <Card variant="borderless">
    <Result
      status="500"
      title="500"
      subTitle="Something went wrong on our side. Try again in a moment."
      extra={
        <Link to="/overview" prefetch>
          <Button type="primary">Go to Overview</Button>
        </Link>
      }
    />
  </Card>
);
