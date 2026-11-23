import { useModel } from '@umijs/max';
import { useQuery } from '@tanstack/react-query';
import { createStyles } from 'antd-style';
import React from 'react';
import { getSystemStatus } from '@/services/socialhub/system';

const useStyles = createStyles(({ token, css }) => ({
  footer: css`
    padding: ${token.padding}px ${token.paddingLG}px;
    text-align: center;
    color: ${token.colorTextDescription};
    font-size: ${token.fontSizeSM}px;
  `,
}));

/**
 * "Social Hub {release}" for admins, "Social Hub" for operators (DESIGN-SYSTEM.md section 1).
 * The release label comes from the admin-only system status endpoint (E11-S02).
 */
const Footer: React.FC = () => {
  const { styles } = useStyles();
  const { initialState } = useModel('@@initialState');
  const isAdmin = initialState?.currentUser?.access === 'admin';
  const statusQuery = useQuery({
    queryKey: ['system-status'],
    queryFn: getSystemStatus,
    enabled: isAdmin,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const release = statusQuery.data?.release;
  return (
    <footer className={styles.footer}>
      {isAdmin && release ? `Social Hub ${release}` : 'Social Hub'}
    </footer>
  );
};

export default Footer;
