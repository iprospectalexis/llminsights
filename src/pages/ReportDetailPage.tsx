import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Download, ArrowLeft, Loader } from 'lucide-react';
import { Button } from '../components/ui/Button';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ReportContent {
  metadata: {
    tokensAnalyzed: number;
    responsesAnalyzed: number;
    auditDate: string;
    targetBrand: string;
    targetLlm: string;
    language: string;
  };
  executiveSummary: string;
  brandStrengthsWeaknesses: {
    strengths: Array<{ category: string; description: string }>;
    weaknesses: Array<{ category: string; description: string }>;
  };
  competitorsAssessment: Array<{
    brand: string;
    strengths: string;
    weaknesses: string;
  }>;
}

interface Report {
  id: string;
  project_id: string;
  report_type: string;
  target_brand: string;
  target_llm: string;
  report_language: string;
  status: string;
  report_content: ReportContent;
  created_at: string;
  completed_at: string;
}

interface Project {
  id: string;
  name: string;
}

export default function ReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (reportId) {
      fetchReport();
    }
  }, [reportId]);

  const fetchReport = async () => {
    try {
      setLoading(true);

      const { data: reportData, error: reportError } = await supabase
        .from('insight_reports')
        .select('*')
        .eq('id', reportId)
        .single();

      if (reportError) throw reportError;

      setReport(reportData);

      // Fetch project data
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('id, name')
        .eq('id', reportData.project_id)
        .single();

      if (projectError) throw projectError;

      setProject(projectData);
    } catch (error) {
      console.error('Error fetching report:', error);
      alert('Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = async () => {
    if (!report || !project) return;

    try {
      setExporting(true);

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      let yPos = 20;

      // Header - Brand Strengths & Weaknesses Report from LLM Insights by iProspect
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('Brand Strengths & Weaknesses Report', pageWidth / 2, yPos, { align: 'center' });
      yPos += 5;
      doc.text('from LLM Insights by iProspect', pageWidth / 2, yPos, { align: 'center' });
      yPos += 15;

      // Metadata section
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      doc.text(`Brand: ${report.report_content.metadata.targetBrand}`, 14, yPos);
      yPos += 5;
      doc.text(`LLM: ${report.report_content.metadata.targetLlm}`, 14, yPos);
      yPos += 5;
      doc.text(`Date: ${new Date(report.report_content.metadata.auditDate).toLocaleDateString()}`, 14, yPos);
      yPos += 5;
      doc.text(`Tokens Analyzed: ${report.report_content.metadata.tokensAnalyzed.toLocaleString()}`, 14, yPos);
      yPos += 5;
      doc.text(`Responses: ${report.report_content.metadata.responsesAnalyzed}`, 14, yPos);
      yPos += 12;

      // Executive Summary
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text('GEO Executive Summary', 14, yPos);
      yPos += 8;

      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      const summaryLines = doc.splitTextToSize(report.report_content.executiveSummary, pageWidth - 28);
      doc.text(summaryLines, 14, yPos);
      yPos += summaryLines.length * 5 + 10;

      // Check if we need a new page
      if (yPos > 250) {
        doc.addPage();
        yPos = 20;
      }

      // Brand Strengths & Weaknesses
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text('Brand Strengths & Weaknesses', 14, yPos);
      yPos += 8;

      // Strengths table
      doc.setFontSize(12);
      doc.text('Strengths', 14, yPos);
      yPos += 5;

      const strengthsData = report.report_content.brandStrengthsWeaknesses.strengths.map(s => [
        s.category,
        s.description
      ]);

      autoTable(doc, {
        startY: yPos,
        head: [['Category', 'Description']],
        body: strengthsData,
        theme: 'plain',
        headStyles: { fillColor: [67, 97, 238], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 'auto' } },
      });

      yPos = (doc as any).lastAutoTable.finalY + 10;

      // Check if we need a new page
      if (yPos > 250) {
        doc.addPage();
        yPos = 20;
      }

      // Weaknesses table
      doc.setFontSize(12);
      doc.text('Weaknesses', 14, yPos);
      yPos += 5;

      const weaknessesData = report.report_content.brandStrengthsWeaknesses.weaknesses.map(w => [
        w.category,
        w.description
      ]);

      autoTable(doc, {
        startY: yPos,
        head: [['Category', 'Description']],
        body: weaknessesData,
        theme: 'plain',
        headStyles: { fillColor: [247, 37, 133], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 'auto' } },
      });

      yPos = (doc as any).lastAutoTable.finalY + 15;

      // Check if we need a new page
      if (yPos > 250) {
        doc.addPage();
        yPos = 20;
      }

      // Competitors Assessment
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text('Competitors Assessment', 14, yPos);
      yPos += 8;

      const competitorsData = report.report_content.competitorsAssessment.map(c => [
        c.brand,
        c.strengths,
        c.weaknesses
      ]);

      autoTable(doc, {
        startY: yPos,
        head: [['Brand', 'Strengths', 'Weaknesses']],
        body: competitorsData,
        theme: 'plain',
        headStyles: { fillColor: [86, 11, 173], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 'auto' } },
      });

      // Save PDF
      const fileName = `${report.report_content.metadata.targetBrand}_${report.report_content.metadata.targetLlm}_Report_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  const getReportTitle = (type: string) => {
    switch (type) {
      case 'brand_strengths':
        return 'Brand Strengths & Weaknesses Report';
      case 'content_audit':
        return 'Content Audit Report';
      case 'offsite_visibility':
        return 'Offsite Visibility Report';
      default:
        return 'Report';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!report || !project) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <p className="text-gray-600 dark:text-gray-400 mb-4">Report not found</p>
        <Button onClick={() => navigate(-1)}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant="outline"
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Project
                </Button>
                <div>
                  <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    {getReportTitle(report.report_type)}
                  </h1>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {project.name} • {report.target_brand} • {report.target_llm}
                  </p>
                </div>
              </div>
              <Button
                onClick={handleExportPDF}
                disabled={exporting}
                className="flex items-center gap-2"
              >
                {exporting ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Export PDF
              </Button>
            </div>
          </div>
        </div>

        {/* Report Content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="space-y-8">
            {/* Metadata Section */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-6 border-b border-gray-200 dark:border-gray-700">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Tokens Analyzed</p>
                <p className="text-2xl font-semibold" style={{ background: 'linear-gradient(135deg, #4361ee, #4cc9f0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  {report.report_content.metadata.tokensAnalyzed.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Responses</p>
                <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                  {report.report_content.metadata.responsesAnalyzed}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Audit Date</p>
                <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                  {new Date(report.report_content.metadata.auditDate).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Language</p>
                <p className="text-lg font-medium text-gray-900 uppercase">
                  {report.report_content.metadata.language}
                </p>
              </div>
            </div>

            {/* Executive Summary */}
            <div className="space-y-4">
              <h2 className="text-3xl font-bold" style={{ background: 'linear-gradient(135deg, #7209b7, #4361ee)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                GEO Executive Summary
              </h2>
              <p className="text-lg text-gray-700 dark:text-gray-300 leading-relaxed border-l-4 pl-6" style={{ borderColor: '#4361ee' }}>
                {report.report_content.executiveSummary}
              </p>
            </div>

            {/* Brand Strengths and Weaknesses */}
            <div className="space-y-6">
              <h2 className="text-3xl font-bold" style={{ background: 'linear-gradient(135deg, #b5179e, #7209b7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Brand Strengths & Weaknesses
              </h2>
              <div className="grid md:grid-cols-2 gap-8">
                {/* Strengths */}
                <div className="space-y-4">
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#4895ef' }}></span>
                    Strengths
                  </h3>
                  <div className="space-y-3">
                    {report.report_content.brandStrengthsWeaknesses.strengths.map((item, idx) => (
                      <div key={idx} className="border-l-2 pl-4 py-2" style={{ borderColor: '#4895ef' }}>
                        <p className="font-semibold text-gray-900 dark:text-gray-100">{item.category}</p>
                        <p className="text-gray-700 dark:text-gray-300 text-sm">{item.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Weaknesses */}
                <div className="space-y-4">
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#f72585' }}></span>
                    Weaknesses
                  </h3>
                  <div className="space-y-3">
                    {report.report_content.brandStrengthsWeaknesses.weaknesses.map((item, idx) => (
                      <div key={idx} className="border-l-2 pl-4 py-2" style={{ borderColor: '#f72585' }}>
                        <p className="font-semibold text-gray-900 dark:text-gray-100">{item.category}</p>
                        <p className="text-gray-700 dark:text-gray-300 text-sm">{item.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Competitors Assessment */}
            <div className="space-y-6">
              <h2 className="text-3xl font-bold" style={{ background: 'linear-gradient(135deg, #560bad, #3a0ca3)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Competitors Assessment
              </h2>
              <div className="space-y-4">
                {report.report_content.competitorsAssessment.map((competitor, idx) => (
                  <div key={idx} className="border-t-2 pt-4" style={{ borderColor: `hsl(${(idx * 40) % 360}, 70%, 60%)` }}>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">{competitor.brand}</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Strengths</p>
                        <p className="text-gray-700 dark:text-gray-300">{competitor.strengths}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Weaknesses</p>
                        <p className="text-gray-700 dark:text-gray-300">{competitor.weaknesses}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}
