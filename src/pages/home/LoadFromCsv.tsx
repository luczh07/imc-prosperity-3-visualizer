import { Group, Text } from '@mantine/core';
import { Dropzone, FileRejection } from '@mantine/dropzone';
import { IconUpload } from '@tabler/icons-react';
import { ReactNode, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorAlert } from '../../components/ErrorAlert.tsx';
import { useAsync } from '../../hooks/use-async.ts';
import { useStore } from '../../store.ts';
import { parseCsvData } from '../../utils/algorithm.tsx';
import { HomeCard } from './HomeCard.tsx';

function DropzoneContent(): ReactNode {
  return (
    <Group justify="center" gap="xl" style={{ minHeight: 80, pointerEvents: 'none' }}>
      <IconUpload size={40} />
      <Text size="xl" inline={true}>
        Drag CSV files here or click to select files
      </Text>
    </Group>
  );
}

export function LoadFromCsv(): ReactNode {
  const navigate = useNavigate();

  const [error, setError] = useState<Error>();

  const setAlgorithm = useStore(state => state.setAlgorithm);

  const onDrop = useAsync(
    (files: File[]) =>
      parseCsvData(files).then(algorithm => {
        setError(undefined);
        setAlgorithm(algorithm);
        navigate('/visualizer');
      }),
  );

  const onReject = useCallback((rejections: FileRejection[]) => {
    const messages: string[] = [];

    for (const rejection of rejections) {
      const errorType = {
        'file-invalid-type': 'Invalid type, only CSV files are supported.',
        'file-too-large': 'File too large.',
        'file-too-small': 'File too small.',
        'too-many-files': 'Too many files.',
      }[rejection.errors[0].code]!;

      messages.push(`Could not load ${rejection.file.name}: ${errorType}`);
    }

    setError(new Error(messages.join('<br/>')));
  }, []);

  return (
    <HomeCard title="Load from Data Capsule CSVs">
      <Text>
        Drop the prices and trades CSV files from the IMC Prosperity 4 Data Capsule (e.g.{' '}
        <code>prices_round_1_day_-2.csv</code>, <code>trades_round_1_day_-2.csv</code>, etc.). You can drop multiple
        days at once — timestamps will be normalized so all days appear on the same continuous timeline.
      </Text>

      {error && <ErrorAlert error={error} />}
      {onDrop.error && <ErrorAlert error={onDrop.error} />}

      <Dropzone onDrop={onDrop.call} onReject={onReject} multiple={true} loading={onDrop.loading}>
        <Dropzone.Idle>
          <DropzoneContent />
        </Dropzone.Idle>
        <Dropzone.Accept>
          <DropzoneContent />
        </Dropzone.Accept>
      </Dropzone>
    </HomeCard>
  );
}
