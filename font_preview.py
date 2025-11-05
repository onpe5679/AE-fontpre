import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
from tkinter.font import Font, families
import os
import sys
from pathlib import Path

class FontPreviewApp:
    def __init__(self, root):
        self.root = root
        self.root.title("폰트 미리보기 프로그램")
        self.root.geometry("1200x800")
        
        # 폰트 리스트 가져오기 (세로쓰기 폰트 제외)
        all_system_fonts = sorted(families())
        # '@'로 시작하는 세로쓰기 폰트 필터링
        self.all_fonts = [f for f in all_system_fonts if not f.startswith('@')]
        self.filtered_fonts = self.all_fonts.copy()
        
        # 산돌 폰트 감지
        self.sandoll_fonts = [f for f in self.all_fonts if 'sandoll' in f.lower() or '산돌' in f]
        
        self.setup_ui()
        self.check_sandoll_fonts()
        
    def setup_ui(self):
        # 메인 프레임
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(1, weight=1)
        main_frame.rowconfigure(3, weight=1)
        
        # 제목
        title_label = ttk.Label(main_frame, text="폰트 미리보기", 
                               font=('Arial', 16, 'bold'))
        title_label.grid(row=0, column=0, columnspan=3, pady=10)
        
        # 미리보기 텍스트 입력
        ttk.Label(main_frame, text="미리보기 텍스트:").grid(row=1, column=0, sticky=tk.W, pady=5)
        self.preview_text = tk.StringVar(value="The quick brown fox jumps over the lazy dog. 1234567890")
        preview_entry = ttk.Entry(main_frame, textvariable=self.preview_text, width=50)
        preview_entry.grid(row=1, column=1, columnspan=2, sticky=(tk.W, tk.E), pady=5, padx=5)
        preview_entry.bind('<KeyRelease>', lambda e: self.update_preview())
        
        # 폰트 크기 조절
        ttk.Label(main_frame, text="폰트 크기:").grid(row=2, column=0, sticky=tk.W, pady=5)
        self.font_size = tk.IntVar(value=20)
        size_scale = ttk.Scale(main_frame, from_=8, to=72, variable=self.font_size, 
                              orient=tk.HORIZONTAL, command=lambda v: self.update_preview())
        size_scale.grid(row=2, column=1, sticky=(tk.W, tk.E), pady=5, padx=5)
        
        size_label = ttk.Label(main_frame, textvariable=self.font_size, width=5)
        size_label.grid(row=2, column=2, sticky=tk.W)
        
        # 폰트 검색
        search_frame = ttk.Frame(main_frame)
        search_frame.grid(row=3, column=0, sticky=(tk.N, tk.S, tk.W, tk.E), pady=5)
        
        ttk.Label(search_frame, text="폰트 검색:").pack(anchor=tk.W)
        self.search_var = tk.StringVar()
        search_entry = ttk.Entry(search_frame, textvariable=self.search_var)
        search_entry.pack(fill=tk.X, pady=5)
        search_entry.bind('<KeyRelease>', lambda e: self.filter_fonts())
        
        # 산돌 폰트 필터 체크박스
        self.show_sandoll_only = tk.BooleanVar(value=False)
        sandoll_check = ttk.Checkbutton(search_frame, text="산돌 폰트만 보기", 
                                       variable=self.show_sandoll_only,
                                       command=self.filter_fonts)
        sandoll_check.pack(anchor=tk.W, pady=5)
        
        # 산돌 폰트 개수 표시
        sandoll_info = ttk.Label(search_frame, 
                                text=f"산돌 폰트 감지: {len(self.sandoll_fonts)}개",
                                foreground="blue")
        sandoll_info.pack(anchor=tk.W, pady=5)
        
        # 필터링 정보
        filter_info = ttk.Label(search_frame, 
                               text="※ '@'로 시작하는 세로쓰기 폰트는 제외됨",
                               foreground="gray", font=('Arial', 8))
        filter_info.pack(anchor=tk.W, pady=2)
        
        # 폰트 리스트
        ttk.Label(search_frame, text="폰트 목록:").pack(anchor=tk.W, pady=(10, 0))
        
        listbox_frame = ttk.Frame(search_frame)
        listbox_frame.pack(fill=tk.BOTH, expand=True, pady=5)
        
        scrollbar = ttk.Scrollbar(listbox_frame)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        self.font_listbox = tk.Listbox(listbox_frame, yscrollcommand=scrollbar.set)
        self.font_listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.config(command=self.font_listbox.yview)
        
        self.font_listbox.bind('<<ListboxSelect>>', self.on_font_select)
        
        # 폰트 리스트 초기화
        self.update_font_list()
        
        # 미리보기 영역
        preview_frame = ttk.LabelFrame(main_frame, text="미리보기", padding="10")
        preview_frame.grid(row=3, column=1, columnspan=2, sticky=(tk.N, tk.S, tk.W, tk.E), 
                          pady=5, padx=(10, 0))
        preview_frame.columnconfigure(0, weight=1)
        preview_frame.rowconfigure(0, weight=1)
        
        # 스크롤 가능한 캔버스
        canvas_frame = ttk.Frame(preview_frame)
        canvas_frame.grid(row=0, column=0, sticky=(tk.N, tk.S, tk.W, tk.E))
        canvas_frame.columnconfigure(0, weight=1)
        canvas_frame.rowconfigure(0, weight=1)
        
        preview_scrollbar = ttk.Scrollbar(canvas_frame)
        preview_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        self.preview_canvas = tk.Canvas(canvas_frame, yscrollcommand=preview_scrollbar.set,
                                       bg='white')
        self.preview_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        preview_scrollbar.config(command=self.preview_canvas.yview)
        
        self.preview_frame_inner = ttk.Frame(self.preview_canvas)
        self.preview_canvas.create_window((0, 0), window=self.preview_frame_inner, anchor='nw')
        
        # 폰트 정보 표시
        self.font_info_label = ttk.Label(preview_frame, text="", foreground="gray")
        self.font_info_label.grid(row=1, column=0, sticky=tk.W, pady=(10, 0))
        
        self.preview_frame_inner.bind('<Configure>', 
                                     lambda e: self.preview_canvas.configure(
                                         scrollregion=self.preview_canvas.bbox('all')))
        
    def update_font_list(self):
        """폰트 리스트 업데이트"""
        self.font_listbox.delete(0, tk.END)
        for font in self.filtered_fonts:
            display_name = font
            if font in self.sandoll_fonts:
                display_name = f"⭐ {font}"
            self.font_listbox.insert(tk.END, display_name)
    
    def filter_fonts(self):
        """폰트 필터링"""
        search_term = self.search_var.get().lower()
        
        if self.show_sandoll_only.get():
            base_fonts = self.sandoll_fonts
        else:
            base_fonts = self.all_fonts
        
        if search_term:
            self.filtered_fonts = [f for f in base_fonts if search_term in f.lower()]
        else:
            self.filtered_fonts = base_fonts.copy()
        
        self.update_font_list()
    
    def on_font_select(self, event):
        """폰트 선택 시 미리보기 업데이트"""
        selection = self.font_listbox.curselection()
        if selection:
            self.update_preview()
    
    def update_preview(self):
        """미리보기 업데이트"""
        # 기존 위젯 제거
        for widget in self.preview_frame_inner.winfo_children():
            widget.destroy()
        
        selection = self.font_listbox.curselection()
        if not selection:
            return
        
        idx = selection[0]
        if idx >= len(self.filtered_fonts):
            return
            
        font_name = self.filtered_fonts[idx]
        text = self.preview_text.get()
        size = self.font_size.get()
        
        # 폰트 정보 업데이트
        is_sandoll = font_name in self.sandoll_fonts
        info_text = f"폰트: {font_name} | 크기: {size}"
        if is_sandoll:
            info_text += " | ⚠️ 산돌 폰트"
        self.font_info_label.config(text=info_text)
        
        # 폰트 적용 시도
        try:
            # 일반 스타일
            font = Font(family=font_name, size=size)
            label = tk.Label(self.preview_frame_inner, text=text, font=font, 
                           bg='white', anchor='w', justify='left')
            label.pack(fill=tk.X, pady=10, padx=10)
            
            # Bold 스타일
            font_bold = Font(family=font_name, size=size, weight='bold')
            label_bold = tk.Label(self.preview_frame_inner, text=f"{text} (Bold)", 
                                 font=font_bold, bg='white', anchor='w', justify='left')
            label_bold.pack(fill=tk.X, pady=10, padx=10)
            
            # Italic 스타일
            font_italic = Font(family=font_name, size=size, slant='italic')
            label_italic = tk.Label(self.preview_frame_inner, text=f"{text} (Italic)", 
                                   font=font_italic, bg='white', anchor='w', justify='left')
            label_italic.pack(fill=tk.X, pady=10, padx=10)
            
            # 숫자 테스트
            number_text = "0123456789"
            label_num = tk.Label(self.preview_frame_inner, text=number_text, 
                                font=font, bg='white', anchor='w')
            label_num.pack(fill=tk.X, pady=10, padx=10)
            
            # 특수문자 테스트
            special_text = "!@#$%^&*()_+-=[]{}|;:',.<>?/~`"
            label_special = tk.Label(self.preview_frame_inner, text=special_text, 
                                    font=font, bg='white', anchor='w')
            label_special.pack(fill=tk.X, pady=10, padx=10)
            
            # 산돌 폰트 경고
            if is_sandoll:
                warning = tk.Label(self.preview_frame_inner, 
                                 text="⚠️ 산돌 폰트는 DRM 보호로 인해 일부 환경에서\n정상적으로 표시되지 않을 수 있습니다.\n산돌클라우드 앱이 실행 중인지 확인하세요.",
                                 fg='red', bg='#ffe6e6', pady=10, font=('Arial', 10))
                warning.pack(fill=tk.X, pady=10, padx=10)
                
        except Exception as e:
            error_label = tk.Label(self.preview_frame_inner, 
                                  text=f"❌ 폰트 로드 실패: {str(e)}\n이 폰트는 사용할 수 없거나 보호되어 있습니다.",
                                  fg='red', bg='#ffe6e6', pady=20, font=('Arial', 12))
            error_label.pack(fill=tk.BOTH, expand=True, padx=10)
            
            if is_sandoll:
                help_label = tk.Label(self.preview_frame_inner,
                                    text="💡 산돌 폰트 문제 해결 방법:\n"
                                         "1. 산돌클라우드 앱이 실행 중인지 확인\n"
                                         "2. 산돌클라우드에서 폰트 활성화 확인\n"
                                         "3. 컴퓨터 재시작 후 다시 시도",
                                    fg='blue', bg='white', pady=10, font=('Arial', 10),
                                    justify='left', anchor='w')
                help_label.pack(fill=tk.X, padx=10, pady=10)
        
        # 스크롤 영역 업데이트
        self.preview_frame_inner.update_idletasks()
        self.preview_canvas.configure(scrollregion=self.preview_canvas.bbox('all'))
    
    def check_sandoll_fonts(self):
        """산돌 폰트 체크"""
        if self.sandoll_fonts:
            print(f"\n=== 산돌 폰트 감지 결과 ===")
            print(f"총 {len(self.sandoll_fonts)}개의 산돌 폰트가 감지되었습니다:")
            for font in self.sandoll_fonts:
                print(f"  - {font}")
            print("\n⚠️ 산돌 폰트는 DRM 보호로 인해 다음과 같은 제한이 있을 수 있습니다:")
            print("  1. 산돌클라우드 앱이 실행 중이어야 함")
            print("  2. 폰트가 활성화되어 있어야 함")
            print("  3. 일부 프로그램에서는 사용 불가능할 수 있음")
            print("=" * 50)
        else:
            print("\n산돌 폰트가 감지되지 않았습니다.")

def main():
    root = tk.Tk()
    app = FontPreviewApp(root)
    root.mainloop()

if __name__ == "__main__":
    main()

