import { ProCard } from '@ant-design/pro-components';
import { Col, Form, Row, Typography, theme } from 'antd';
import React from 'react';
import type { ScriptRule } from '@/services/socialhub/formats';
import { SCRIPT_LIMITS } from '@/services/socialhub/scripts';
import { ContentInput, ContentTextArea, Field, type FieldState, useContentLang } from './fields';
import { type EditorPackage, fieldDomId } from './scriptModel';
import type { StoryField } from './useScriptEditor';

export type StoryCardProps = {
  pkg: EditorPackage;
  rule: ScriptRule;
  isImage: boolean;
  state: FieldState;
  onChange: (field: StoryField, value: string) => void;
};

/** Scenario, hook, call to action, music hint and the total duration (E05-S02 Story). */
const StoryCard: React.FC<StoryCardProps> = ({ pkg, rule, isImage, state, onChange }) => {
  const { token } = theme.useToken();
  const lang = useContentLang();
  const L = SCRIPT_LIMITS;
  const durationWarning = state.status('duration_seconds') !== undefined;
  return (
    <ProCard title="Story" headerBordered>
      <Form layout="vertical" component="div">
        <Row gutter={[token.marginLG, 0]}>
          <Col xs={24} lg={12}>
            <Field path="scenario" label="Scenario" state={state} required>
              <ContentTextArea
                path="scenario"
                lang={lang}
                max={L.scenario.max}
                rows={4}
                value={pkg.scenario}
                disabled={state.disabled}
                onChange={(e) => onChange('scenario', e.target.value)}
              />
            </Field>
          </Col>
          <Col xs={24} lg={12}>
            <Field path="hook" label="Hook" state={state} required>
              <ContentInput
                path="hook"
                lang={lang}
                max={L.hook.max}
                value={pkg.hook}
                disabled={state.disabled}
                onChange={(e) => onChange('hook', e.target.value)}
              />
            </Field>
            <Field path="cta" label="Call to action" state={state}>
              <ContentInput
                path="cta"
                lang={lang}
                max={L.cta.max}
                value={pkg.cta}
                disabled={state.disabled}
                onChange={(e) => onChange('cta', e.target.value)}
              />
            </Field>
          </Col>
          {isImage ? null : (
            <>
              <Col xs={24} lg={12}>
                <Field path="music_hint" label="Music hint" state={state}>
                  <ContentInput
                    path="music_hint"
                    lang={lang}
                    max={L.music_hint.max}
                    value={pkg.music_hint}
                    disabled={state.disabled}
                    onChange={(e) => onChange('music_hint', e.target.value)}
                  />
                </Field>
              </Col>
              <Col xs={24} lg={12}>
                <Typography.Text
                  id={fieldDomId('duration_seconds')}
                  tabIndex={-1}
                  type={durationWarning ? 'warning' : undefined}
                >
                  {`Total duration: ${pkg.duration_seconds} s (${rule.duration_seconds.min}–${rule.duration_seconds.max} s)`}
                </Typography.Text>
              </Col>
            </>
          )}
        </Row>
      </Form>
    </ProCard>
  );
};

export default StoryCard;
