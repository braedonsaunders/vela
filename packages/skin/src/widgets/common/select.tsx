// Widget `select` on native (iOS, tvOS, Android, Android TV): the current choice in the node's
// box, in its inherited ink and font; pressing it opens the choices in a popover list that the
// focus engine and a D-pad can walk. The web draws the browser's own select (select.web.tsx).
import { FocusPressable as Pressable } from '../../focus';
import { useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, View } from 'react-native';
import { useInheritedText, type WidgetProps } from '../../host';
import { APressable, Glyph, NO_RING, overlaid, useInteraction, Words } from './controls';
import { useLook } from './look';
import { useSelectModel, type Choice } from './select-model';
import { useFocusClaim } from './focus-claim';

export function Select(props: WidgetProps) {
  const model = useSelectModel(props);
  const drawn = useInheritedText();
  const [open, setOpen] = useState(false);
  const current = model.choices.find(choice => choice.value === model.value) ?? model.choices[0];
  const choose = (value: string) => {
    setOpen(false);
    if (value !== model.value) model.choose(value);
  };
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="combobox"
        accessibilityLabel={model.label || undefined}
        accessibilityValue={{ text: current?.label }}
        accessibilityState={{ expanded: open }}
        testID={props.params.testId}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}
      >
        <Text style={[drawn.style, { flexShrink: 1 }]} numberOfLines={1}>
          {current?.label ?? ''}
        </Text>
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <Glyph symbol="forward-chevron" size={14} color={(drawn.style.color as string | undefined) ?? '#ffffff'} />
        </View>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        supportedOrientations={['portrait', 'landscape']}
      >
        <Choices
          title={model.label}
          choices={model.choices}
          value={model.value}
          onChoose={choose}
          onClose={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

function Choices({
  title,
  choices,
  value,
  onChoose,
  onClose,
}: {
  title: string;
  choices: Choice[];
  value: string;
  onChoose(value: string): void;
  onClose(): void;
}) {
  const look = useLook();
  const panel = look.box({
    width: '100%',
    'max-width': '420px',
    'max-height': '70vh',
    padding: '10px',
    'border-radius': '$ui.radiusPanel',
    'background-color': '$ui.popover',
    border: '1px solid $ui.glassEdge',
    'box-shadow': '0px 24px 80px $ui.shadow',
  });
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: look.ui.scrim }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={title}
        focusable={false}
      />
      <View style={panel} accessibilityRole="menu" accessibilityLabel={title}>
        <FlatList
          data={choices}
          keyExtractor={choice => choice.value}
          renderItem={({ item }) => <ChoiceRow choice={item} on={item.value === value} onChoose={onChoose} />}
        />
      </View>
    </View>
  );
}

function ChoiceRow({ choice, on, onChoose }: { choice: Choice; on: boolean; onChoose(value: string): void }) {
  const claim = useFocusClaim(on);
  const look = useLook();
  const { state, handlers } = useInteraction();
  const rows = overlaid(
    {
      'flex-direction': 'row',
      'align-items': 'center',
      'justify-content': 'space-between',
      gap: '12px',
      'min-height': '48px',
      padding: '10px 14px',
      'border-radius': '12px',
    },
    state,
    { hover: { 'background-color': '$ui.control' }, focus: { 'background-color': '$ui.controlHover' } },
  );
  return (
    <APressable
      onPress={() => onChoose(choice.value)}
      accessibilityRole="menuitem"
      accessibilityState={{ checked: on }}
      hasTVPreferredFocus={claim}
      style={[look.box(rows), NO_RING]}
      {...handlers}
    >
      <Words rows={{ 'font-size': '16px', 'font-weight': on ? '650' : '400' }} lines={1}>
        {choice.label}
      </Words>
      {on ? <Glyph symbol="checkmark" size={16} color={look.ui.accent} /> : null}
    </APressable>
  );
}
