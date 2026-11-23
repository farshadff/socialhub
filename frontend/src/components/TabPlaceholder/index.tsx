import { Empty } from 'antd';
import React from 'react';

/** A workspace tab owned by a later epic (E00-S02, E03-S04): one sentence, nothing else. */
const TabPlaceholder: React.FC<{ text: string }> = ({ text }) => (
  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />
);

export default TabPlaceholder;
